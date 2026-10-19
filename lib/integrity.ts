// Evidence integrity, in code rather than in the prompt:
// - findContradictions: facts in the case file that disagree with each other
//   or with the buyer's claim, so the merchant sees them before PayPal does.
// - verifyDecision: every evidence item must cite case-file facts, and every
//   tracking number or amount the agent writes must exist in the records.
//   Anything else is blocked from submission.

import { deliveredZip, type CaseFile } from "./casefile";
import { detectFeatures } from "./score";
import type { Decision } from "./types";

export type Contradiction = {
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  facts: string[];
  /** Whose side it helps, so it reads as a finding rather than an alarm. */
  helps: "seller" | "buyer" | "neither";
};

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "?");
const surname = (s: string | null | undefined) => s?.trim().split(/\s+/).at(-1)?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";

export function findContradictions(cf: CaseFile): Contradiction[] {
  const out: Contradiction[] = [];
  const delivered = cf.tracking.filter((t) => t.status === "DELIVERED");

  if (cf.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && delivered.length) {
    const t = delivered[0];
    out.push({
      severity: "high",
      title: "Claim vs carrier",
      detail: `The buyer says the item never arrived; the carrier recorded delivery on ${day(t.delivered_at)}${t.delivery_location ? ` at ${t.delivery_location}` : ""}.`,
      facts: ["dispute.reason", t.fact],
      helps: "seller",
    });
  }

  for (const t of delivered) {
    const z = deliveredZip(t);
    if (z && cf.shipTo?.zip && z !== cf.shipTo.zip) {
      out.push({
        severity: "high",
        title: "Delivered to a different ZIP",
        detail: `The carrier delivered in ZIP ${z}, but the order ships to ZIP ${cf.shipTo.zip}. PayPal requires delivery to the order's address.`,
        facts: [t.fact, "order.ship_to"],
        helps: "buyer",
      });
    }
    if (t.signature && cf.shipTo?.name && cf.payer?.name) {
      const s = surname(t.signature);
      if (s && s !== surname(cf.shipTo.name) && s !== surname(cf.payer.name)) {
        out.push({
          severity: "medium",
          title: "Signature doesn't match",
          detail: `Signed for by "${t.signature}", which matches neither the payer nor the recipient.`,
          facts: [t.fact.replace(".status", ".signature"), "order.payer", "order.ship_to"],
          helps: "buyer",
        });
      }
    }
    const shipped = cf.trackers.find((x) => x.number === t.tracking_number)?.shippedAt;
    if (t.delivered_at && shipped && Date.parse(t.delivered_at) < Date.parse(shipped)) {
      out.push({
        severity: "medium",
        title: "Timeline doesn't add up",
        detail: `Delivery (${day(t.delivered_at)}) is recorded before the shipment was created (${day(shipped)}).`,
        facts: [t.fact, cf.trackers.find((x) => x.number === t.tracking_number)!.fact],
        helps: "buyer",
      });
    }
  }

  for (const t of cf.tracking) {
    if (t.status === "UNKNOWN" && t.source !== "none") {
      out.push({
        severity: "medium",
        title: "Carrier has no record",
        detail: `The tracking number ${t.tracking_number} is on the order, but the carrier returned no scans for it.`,
        facts: [t.fact],
        helps: "buyer",
      });
    }
  }

  const features = detectFeatures(cf);
  if (cf.reason === "UNAUTHORISED" && features.has("prior_contact")) {
    out.push({
      severity: "high",
      title: "Claim vs earlier messages",
      detail: "The buyer says they didn't authorize the payment, but wrote to you about this order before opening the dispute.",
      facts: ["dispute.reason", ...(features.get("prior_contact") ?? [])],
      helps: "seller",
    });
  }
  if (features.has("ship_to_other")) {
    out.push({
      severity: cf.reason === "UNAUTHORISED" ? "medium" : "info",
      title: "Shipped to someone other than the payer",
      detail: `Payer ${cf.payer?.name ?? "?"}${cf.payer?.zip ? ` (ZIP ${cf.payer.zip})` : ""}; recipient ${cf.shipTo?.name ?? "?"}${cf.shipTo?.zip ? ` (ZIP ${cf.shipTo.zip})` : ""}. Often a gift, which explains a "not received" claim.`,
      facts: ["order.payer", "order.ship_to"],
      helps: "neither",
    });
  }
  if (cf.captureAmount !== null && Math.abs(cf.captureAmount - cf.amount) > 0.005) {
    out.push({
      severity: "info",
      title: "Partial dispute",
      detail: `The buyer disputes ${cf.amount.toFixed(2)} of a ${cf.captureAmount.toFixed(2)} payment.`,
      facts: ["dispute.amount", "payment.capture"],
      helps: "neither",
    });
  }
  return out;
}

export type Problem = { level: "block" | "warn"; text: string };

export type Verification = {
  ok: boolean;
  problems: Problem[];
  /** Per evidence item: the cited facts that exist in the case file. */
  items: { index: number; cited: string[]; missing: string[] }[];
};

const TRACKING = /\b(1Z[0-9A-Z]{14,20}|9\d{15,25}|SHIPPO_[A-Z_]+|\d{12}|\d{15})\b/g;
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;

/**
 * Checks a decision against the case file. `rules` carries the merchant's
 * hard rules (Settings) so they hold even if the model ignores the prompt.
 */
export function verifyDecision(d: Pick<Decision, "action" | "evidence" | "seller_statement">, cf: CaseFile, rules: { requireDeliveryProof: boolean }): Verification {
  const problems: Problem[] = [];
  const known = new Set(cf.facts.map((f) => f.id));
  const numbers = new Set(cf.trackers.map((t) => t.number.toUpperCase()));
  const items = d.evidence.map((e, index) => {
    const sources = e.sources ?? [];
    return { index, cited: sources.filter((s) => known.has(s)), missing: sources.filter((s) => !known.has(s)) };
  });

  if (d.action === "FIGHT") {
    if (!d.evidence.length) problems.push({ level: "block", text: "A fight needs at least one piece of evidence." });
    d.evidence.forEach((e, i) => {
      const it = items[i];
      if (!it.cited.length) problems.push({ level: "block", text: `Evidence ${i + 1} (${e.evidence_type}) cites no fact from the case file.` });
      if (it.missing.length) problems.push({ level: "block", text: `Evidence ${i + 1} cites facts that don't exist: ${it.missing.join(", ")}.` });
      if (e.tracking_number && !numbers.has(e.tracking_number.toUpperCase())) {
        problems.push({ level: "block", text: `Evidence ${i + 1} uses tracking number ${e.tracking_number}, which isn't on the order.` });
      }
    });

    for (const m of d.seller_statement.matchAll(TRACKING)) {
      if (!numbers.has(m[1].toUpperCase())) problems.push({ level: "block", text: `The statement mentions tracking number ${m[1]}, which isn't on the order.` });
    }
    const amounts = new Set<number>([cf.amount, ...(cf.captureAmount !== null ? [cf.captureAmount] : [])]);
    for (const i of cf.items) if (i.unit !== null) amounts.add(i.unit).add(i.unit * i.quantity);
    for (const m of d.seller_statement.matchAll(AMOUNT)) {
      const v = Number(m[1].replace(/,/g, ""));
      if (![...amounts].some((a) => Math.abs(a - v) < 0.005)) {
        problems.push({ level: "warn", text: `The statement mentions $${m[1]}, which doesn't match the dispute, payment or item amounts.` });
      }
    }

    const features = detectFeatures(cf);
    if (rules.requireDeliveryProof && cf.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && !features.has("delivered_to_address")) {
      problems.push({ level: "block", text: "Your rule: never fight \"not received\" without carrier-confirmed delivery to the ship-to address." });
    }
  }

  return { ok: !problems.some((p) => p.level === "block"), problems, items };
}
