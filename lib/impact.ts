// Money and time math for the dashboard: what each decision is worth, and what
// the autopilot has saved overall. Pure functions; the assumptions come from settings.

import type { CaseRecord, DisputeSummary } from "./types";
import type { Settings } from "./settings";

export type Assumptions = {
  /** PayPal's dispute fee. */
  disputeFee: number;
  /** "lost": charged only when PayPal rules for the buyer. "always": charged on every fight. */
  feeWhen: "lost" | "always";
  /** How long a merchant spends on one dispute by hand (for hours saved). */
  manualMinutes: number;
  hourlyRate: number;
  /** Minutes to review and approve a fight the agent prepared. */
  reviewMinutes: number;
  /** Share of the price recovered when a returned "not as described" item can be resold. */
  returnRecoveryPct: number;
};

export function assumptions(s: Settings): Assumptions {
  return {
    disputeFee: s.disputeFee,
    feeWhen: s.feeWhen,
    manualMinutes: s.manualMinutes,
    hourlyRate: s.hourlyRate,
    reviewMinutes: s.reviewMinutes,
    returnRecoveryPct: s.returnRecoveryPct,
  };
}

/** Approving a refund takes a couple of minutes either way. */
const REFUND_MINUTES = 2;

/**
 * What each choice costs this merchant on average. Refunding gives up the
 * amount (less anything recovered from a return) for sure. Fighting gives it
 * up only when PayPal rules for the buyer, adds the fee (when lost, or always,
 * per the merchant's fee schedule), and costs review time.
 */
export type ExpectedValue = {
  amount: number;
  winProbability: number;
  refundCost: number;
  fightCost: number;
  /** Positive when fighting beats refunding on average. */
  fightEdge: number;
  fee: number;
  feeWhen: "lost" | "always";
  /** Value of a returned item ("not as described" only). */
  recovery: number;
  timeCostFight: number;
  timeCostRefund: number;
  /** Win probability above which fighting beats refunding; 1 when fighting never pays. */
  breakEven: number;
};

export function expectedValue(amount: number, winProbability: number, a: Assumptions, reason?: string): ExpectedValue {
  const p = winProbability;
  const recovery = reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" ? (amount * a.returnRecoveryPct) / 100 : 0;
  const lose = amount - recovery;
  const timeCostFight = (a.reviewMinutes / 60) * a.hourlyRate;
  const timeCostRefund = (REFUND_MINUTES / 60) * a.hourlyRate;
  const refundCost = lose + timeCostRefund;
  const fightCost =
    a.feeWhen === "always"
      ? (1 - p) * lose + a.disputeFee + timeCostFight
      : (1 - p) * (lose + a.disputeFee) + timeCostFight;
  let breakEven: number;
  if (lose <= 0) breakEven = 1;
  else if (a.feeWhen === "always") breakEven = (a.disputeFee + timeCostFight - timeCostRefund) / lose;
  else breakEven = 1 - (lose + timeCostRefund - timeCostFight) / (lose + a.disputeFee);
  return {
    amount,
    winProbability: p,
    refundCost,
    fightCost,
    fightEdge: refundCost - fightCost,
    fee: a.disputeFee,
    feeWhen: a.feeWhen,
    recovery,
    timeCostFight,
    timeCostRefund,
    breakEven: Math.min(1, Math.max(0, breakEven)),
  };
}

export type Impact = {
  handled: number;
  hoursSaved: number;
  /** Money kept: in full where the buyer withdrew or PayPal ruled for you, expected value on fights still open. */
  protectedApproved: number;
  /** Disputes that ended in the merchant's favour (won or withdrawn), in money. */
  recovered: number;
  withdrawn: number;
  /** Decisions the agent carried out on its own under the autonomy rules. */
  autoActed: number;
  /** Same, for fights still waiting for approval. */
  protectedPending: number;
  /** Expected gain of the agent's calls vs. refunding every dispute. */
  edgeVsRefundAll: number;
  projectedWinRate: number | null;
  executed: number;
  deadlinesMet: number;
  /** Average days between the agent's draft and the response deadline. */
  avgLeadDays: number | null;
  nextDeadlineDays: number | null;
};

type Row = DisputeSummary & { case: CaseRecord | null };

const DAY = 86_400_000;

export function computeImpact(rows: Row[], a: Assumptions): Impact {
  const decided = rows.filter((r) => r.case?.decision);
  const fights = decided.filter((r) => r.case!.decision!.action === "FIGHT");
  const won = (r: Row) => r.outcome === "CANCELED_BY_BUYER" || r.outcome === "RESOLVED_SELLER_FAVOUR";
  const kept = (r: Row) => Number(r.amount.value) * r.case!.decision!.win_probability;
  const wins = decided.filter(won);
  const recovered = wins.reduce((s, r) => s + Number(r.amount.value), 0);
  const openFights = fights.filter((r) => !won(r));
  const executed = decided.filter((r) => r.case!.status === "executed");
  const onTime = executed.filter(
    (r) => !r.sellerResponseDueDate || !r.case!.execution || r.case!.execution.at <= r.sellerResponseDueDate,
  );
  const leads = decided
    .filter((r) => r.sellerResponseDueDate && r.case!.investigatedAt)
    .map((r) => (Date.parse(r.sellerResponseDueDate!) - Date.parse(r.case!.investigatedAt!)) / DAY);
  const open = rows.filter((r) => r.status !== "RESOLVED" && r.case?.status !== "executed" && r.sellerResponseDueDate);
  const next = open.map((r) => (Date.parse(r.sellerResponseDueDate!) - Date.now()) / DAY);

  return {
    handled: decided.length,
    hoursSaved: (decided.length * a.manualMinutes) / 60,
    protectedApproved: recovered + openFights.filter((r) => r.case!.status === "executed").reduce((s, r) => s + kept(r), 0),
    protectedPending: openFights.filter((r) => r.case!.status !== "executed").reduce((s, r) => s + kept(r), 0),
    recovered,
    withdrawn: wins.filter((r) => r.outcome === "CANCELED_BY_BUYER").length,
    autoActed: decided.filter((r) => r.case!.execution?.ok && r.case!.execution.auto).length,
    edgeVsRefundAll: fights.reduce((s, r) => s + Math.max(0, expectedValue(Number(r.amount.value), r.case!.decision!.win_probability, a, r.reason).fightEdge), 0),
    projectedWinRate: fights.length ? fights.reduce((s, r) => s + r.case!.decision!.win_probability, 0) / fights.length : null,
    executed: executed.length,
    deadlinesMet: onTime.length,
    avgLeadDays: leads.length ? leads.reduce((s, d) => s + d, 0) / leads.length : null,
    nextDeadlineDays: next.length ? Math.min(...next) : null,
  };
}
