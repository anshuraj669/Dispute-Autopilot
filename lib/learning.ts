// Outcome learning. Every decision freezes its calibrated estimate and the
// factors behind it (CaseRecord.prediction). Once PayPal rules on a dispute
// the merchant fought, that becomes a labelled example. This module refits
// the scoring weights on those examples and reports, on disputes the model
// hasn't seen, how close the estimates came to what PayPal actually decided.
//
// Refunds are not rulings, so accepted claims never count as losses.
// Demo mode adds a seeded synthetic history (clearly labelled) so the loop is
// visible before a new merchant has any resolved disputes of their own.

import { provider } from "./paypal";
import { allCases } from "./store";
import { FEATURE_LABELS, GROUP_LABELS, PRIOR, type FeatureKey, type Group, type Weights } from "./score";
import type { CaseRecord, DisputeSummary } from "./types";

export type Example = {
  id: string;
  at: string;
  group: Group;
  /** Active weight keys, e.g. "NR.signature". */
  features: string[];
  won: 0 | 1;
  source: "demo" | "real";
  agentEstimate: number | null;
  /** What the app predicted at the time (real examples only). */
  predicted: number | null;
};

/** Needed before learned weights replace the starting ones. */
export const MIN_EXAMPLES = 30;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const predict = (e: Pick<Example, "group" | "features">, w: Weights) =>
  sigmoid((w[`${e.group}.base`] ?? 0) + e.features.reduce((s, k) => s + (w[k] ?? 0), 0));

// ---------------------------------------------------------------------------
// Demo history: 400 resolved disputes, about one a day for a year. (On
// averaged synthetic samples, refitting captures ~15% of the possible accuracy
// gain at 200 disputes, ~35% at 400 and ~55% at 800; one shop's sample is
// noisy, hence the out-of-sample guard below.) Outcomes come from this demo shop's "true" weights, which
// differ from the textbook starting ones the way a real shop's might: delivery
// photos and prior contact matter more, signatures and Seller Protection
// status less, repeat complaints hurt more. Learning has to find that.

export const DEMO_TRUTH: Weights = {
  ...PRIOR,
  "NR.base": -1.8,
  "NR.delivered_to_address": 2.6,
  "NR.signature": 0.3,
  "NR.delivery_photo": 1.4,
  "NR.carrier_pod": 1.0,
  "NR.protection_eligible": 0,
  "UA.base": -1.0,
  "UA.delivered_to_address": 0.3,
  "UA.signature": 0.2,
  "UA.prior_contact": 2.4,
  "UA.ship_to_other": -1.2,
  "UA.device_match": 1.3,
  "UA.protection_eligible": 0,
  "SNAD.base": -0.6,
  "SNAD.listing_snapshot": 0.9,
  "SNAD.item_photos": 1.3,
  "SNAD.repeat_complaints": -2.0,
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoHistory(): Example[] {
  const r = rng(20261112);
  const out: Example[] = [];
  const DAY = 86_400_000;
  for (let i = 0; i < 400; i++) {
    const roll = r();
    const group: Group = roll < 0.45 ? "NR" : roll < 0.75 ? "UA" : roll < 0.95 ? "SNAD" : "OTHER";
    const f = new Set<FeatureKey>();
    const maybe = (k: FeatureKey, chance: number) => r() < chance && f.add(k);
    if (group === "NR") {
      if (r() < 0.85) {
        if (r() < 0.7) {
          f.add("delivered_to_address");
          maybe("signature", 0.15);
          maybe("delivery_photo", 0.4);
          maybe("carrier_pod", 0.2);
        } else maybe("delivered_elsewhere", 0.3);
      } else f.add("no_tracking");
      maybe("protection_eligible", 0.8);
      if (!f.has("signature")) maybe("high_value_no_signature", 0.05);
    } else if (group === "UA") {
      if (r() < 0.9) {
        if (r() < 0.75) f.add("delivered_to_address");
        maybe("signature", 0.25);
      } else f.add("no_tracking");
      maybe("prior_contact", 0.3);
      maybe("ship_to_other", 0.25);
      maybe("repeat_customer", 0.2);
      maybe("device_match", 0.15);
      maybe("protection_eligible", 0.7);
    } else if (group === "SNAD") {
      maybe("listing_snapshot", 0.3);
      maybe("item_photos", 0.35);
      maybe("repeat_complaints", 0.25);
    }
    const features = [...f].map((k) => `${group}.${k}`);
    const won = r() < predict({ group, features }, DEMO_TRUTH) ? 1 : 0;
    out.push({
      id: `HIST-${String(i + 1).padStart(3, "0")}`,
      at: new Date(Date.now() - (365 - i * 0.9) * DAY).toISOString(),
      group,
      features,
      won,
      source: "demo",
      agentEstimate: null,
      predicted: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

const FAVOUR = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER"]);
const AGAINST = new Set(["RESOLVED_BUYER_FAVOUR"]);

/** Disputes the merchant fought, with a frozen prediction, that have an outcome. */
export function realExamples(disputes: DisputeSummary[], cases: Record<string, CaseRecord>): Example[] {
  const out: Example[] = [];
  for (const d of disputes) {
    const c = cases[d.id];
    const pred = c?.prediction;
    if (!pred || !d.outcome || !(c.execution?.ok && c.execution.action === "FIGHT")) continue;
    if (!FAVOUR.has(d.outcome) && !AGAINST.has(d.outcome)) continue;
    out.push({
      id: d.id,
      at: c.execution.at,
      group: pred.group as Group,
      features: pred.features,
      won: FAVOUR.has(d.outcome) ? 1 : 0,
      source: "real",
      agentEstimate: pred.agentEstimate,
      predicted: pred.p,
    });
  }
  return out;
}

/**
 * MAP logistic regression: fits the data while staying close to the starting
 * weights (a Gaussian prior with strength `lambda`), so a handful of cases
 * can't swing a weight wildly. Newton's method on ~20 weights converges in a
 * few steps.
 */
export function fit(data: Example[], start: Weights = PRIOR, lambda = 2, iters = 25): Weights {
  const keys = Object.keys(start);
  const index = new Map(keys.map((k, i) => [k, i]));
  const xs = data.map((e) => [`${e.group}.base`, ...e.features].map((k) => index.get(k)).filter((i): i is number => i !== undefined));
  let w = keys.map((k) => start[k]);
  const w0 = [...w];
  for (let it = 0; it < iters; it++) {
    const grad = w.map((v, i) => lambda * (v - w0[i]));
    const H = keys.map((_, i) => keys.map((__, j) => (i === j ? lambda : 0)));
    data.forEach((e, d) => {
      const z = xs[d].reduce((s, i) => s + w[i], 0);
      const p = 1 / (1 + Math.exp(-z));
      for (const i of xs[d]) {
        grad[i] += p - e.won;
        for (const j of xs[d]) H[i][j] += p * (1 - p);
      }
    });
    const step = solve(H, grad);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return Object.fromEntries(keys.map((k, i) => [k, w[i]]));
}

/** Gaussian elimination with partial pivoting; H is positive definite here. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const brier = (ps: number[], ys: number[]) => (ps.length ? ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / ps.length : null);
const logLoss = (ps: number[], ys: number[]) =>
  ps.length ? -ps.reduce((s, p, i) => s + (ys[i] ? Math.log(Math.max(p, 1e-6)) : Math.log(Math.max(1 - p, 1e-6))), 0) / ps.length : null;

function reliability(ps: number[], ys: number[]) {
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  return bins.slice(0, -1).map((lo, i) => {
    const hi = bins[i + 1];
    const idx = ps.map((p, j) => (p >= lo && p < hi ? j : -1)).filter((j) => j >= 0);
    return {
      bin: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`,
      predicted: idx.length ? idx.reduce((s, j) => s + ps[j], 0) / idx.length : null,
      actual: idx.length ? idx.reduce((s, j) => s + ys[j], 0) / idx.length : null,
      n: idx.length,
    };
  });
}

export type LearningReport = {
  model: string;
  usingLearned: boolean;
  minExamples: number;
  n: number;
  nReal: number;
  nDemo: number;
  /** Out-of-sample scores: each dispute predicted by a model trained only on earlier ones. */
  holdout: {
    n: number;
    brier: { baseRate: number | null; prior: number | null; learned: number | null; agent: number | null };
    logLoss: { baseRate: number | null; prior: number | null; learned: number | null };
    agentN: number;
  };
  reliability: ReturnType<typeof reliability>;
  /** `learned` is the refit candidate; it is live only when usingLearned. */
  weights: { key: string; group: Group; groupLabel: string; feature: string; label: string; prior: number; learned: number }[];
  winRates: { group: Group; label: string; n: number; won: number }[];
  real: { id: string; at: string; group: Group; predicted: number | null; won: 0 | 1; agentEstimate: number | null }[];
};

type Cached = { key: string; weights: Weights; report: LearningReport };
const g = globalThis as typeof globalThis & { __learning?: Cached };

/** The weights the scorer should use right now, and the report behind them. */
export async function learnedModel(disputes?: DisputeSummary[]): Promise<{ weights: Weights; model: string; report: LearningReport }> {
  const paypal = provider();
  const [list, cases] = await Promise.all([disputes ? Promise.resolve(disputes) : paypal.listDisputes(), allCases()]);
  const real = realExamples(list, cases);
  const key = `${paypal.mode}|${real.map((e) => `${e.id}:${e.won}`).join(",")}`;
  if (g.__learning?.key === key) return { weights: g.__learning.weights, model: g.__learning.report.model, report: g.__learning.report };

  const data = [...(paypal.mode === "mock" ? demoHistory() : []), ...real].sort((a, b) => a.at.localeCompare(b.at));
  // Forward-chaining: split history into 5 time slices; for each slice after
  // the first, train only on what came before and predict it. Every scored
  // dispute is one the model hadn't seen, and no prediction peeks at the future.
  const SLICES = 5;
  const size = Math.ceil(data.length / SLICES);
  const test: Example[] = [];
  const pBase: number[] = [];
  const pPrior: number[] = [];
  const pLearned: number[] = [];
  for (let k = 1; k < SLICES; k++) {
    const train = data.slice(0, k * size);
    const slice = data.slice(k * size, (k + 1) * size);
    if (!slice.length || train.length < 10) continue;
    const trained = fit(train);
    const rate = (grp: Group) => {
      const xs = train.filter((e) => e.group === grp);
      return xs.length ? xs.reduce((s, e) => s + e.won, 0) / xs.length : 0.5;
    };
    for (const e of slice) {
      test.push(e);
      pBase.push(rate(e.group));
      pPrior.push(predict(e, PRIOR));
      pLearned.push(predict(e, trained));
    }
  }
  const scored = test.length > 0;
  const ys = test.map((e) => e.won);
  const withAgent = test.filter((e) => e.agentEstimate !== null);

  // Learned weights go live only with enough data AND when they beat the
  // starting rules out of sample, so learning can never make estimates worse.
  const learnedBrier = scored ? brier(pLearned, ys) : null;
  const priorBrier = scored ? brier(pPrior, ys) : null;
  const usingLearned = data.length >= MIN_EXAMPLES && learnedBrier !== null && priorBrier !== null && learnedBrier <= priorBrier;
  const candidate = data.length >= MIN_EXAMPLES ? fit(data) : { ...PRIOR };
  const weights = usingLearned ? candidate : { ...PRIOR };
  const model = usingLearned
    ? `learned on ${data.length} resolved disputes`
    : data.length >= MIN_EXAMPLES
      ? "starting weights (learning hasn't beaten them yet)"
      : "starting weights (Seller Protection rules)";

  const report: LearningReport = {
    model,
    usingLearned,
    minExamples: MIN_EXAMPLES,
    n: data.length,
    nReal: real.length,
    nDemo: data.length - real.length,
    holdout: {
      n: test.length,
      brier: {
        baseRate: brier(pBase, ys),
        prior: priorBrier,
        learned: learnedBrier,
        agent: withAgent.length >= 5 ? brier(withAgent.map((e) => e.agentEstimate!), withAgent.map((e) => e.won)) : null,
      },
      logLoss: { baseRate: logLoss(pBase, ys), prior: logLoss(pPrior, ys), learned: scored ? logLoss(pLearned, ys) : null },
      agentN: withAgent.length,
    },
    // Calibration of the model that is actually live.
    reliability: reliability(usingLearned ? pLearned : pPrior, ys),
    weights: Object.keys(PRIOR).map((k) => {
      const [grp, feature] = k.split(".") as [Group, string];
      return {
        key: k,
        group: grp,
        groupLabel: GROUP_LABELS[grp],
        feature,
        label: feature === "base" ? "Starting odds" : FEATURE_LABELS[feature as FeatureKey],
        prior: PRIOR[k],
        learned: candidate[k],
      };
    }),
    winRates: (["NR", "UA", "SNAD", "OTHER"] as Group[]).map((grp) => {
      const xs = data.filter((e) => e.group === grp);
      return { group: grp, label: GROUP_LABELS[grp], n: xs.length, won: xs.reduce((s, e) => s + e.won, 0) };
    }),
    real: real
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((e) => ({ id: e.id, at: e.at, group: e.group, predicted: e.predicted, won: e.won, agentEstimate: e.agentEstimate })),
  };
  g.__learning = { key, weights, report };
  return { weights, model, report };
}
