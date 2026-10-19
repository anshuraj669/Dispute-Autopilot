// Decides whether the agent may act on a decision without waiting for the
// merchant, following the autonomy rules on the Settings page.

import { assess } from "./assess";
import { executeDecision } from "./execute";
import { sendBuyerMessage } from "./messaging";
import { provider } from "./paypal";
import { getSettings } from "./settings";
import { getCase } from "./store";

const RANK = { low: 0, medium: 1, high: 2 } as const;

/** Returns why the agent acted alone, or null when it left the decision to the merchant. */
export async function maybeActAlone(disputeId: string): Promise<string | null> {
  const [settings, record] = await Promise.all([getSettings(), getCase(disputeId)]);
  const decision = record?.decision;
  if (settings.autonomy !== "auto_small" || !decision || record.status !== "awaiting_approval") return null;

  const dispute = await provider().getDispute(disputeId);
  if (dispute.status === "RESOLVED") return null;
  const amount = Number(dispute.dispute_amount?.value ?? Infinity);
  if (amount > settings.autoLimit) return null;
  if (RANK[decision.confidence] < RANK[settings.autoMinConfidence]) return null;
  // Never act alone on something PayPal won't take, or on evidence that fails the check.
  const a = await assess(disputeId);
  if (!a.permissions[decision.action].allowed || (decision.action === "FIGHT" && !a.verification?.ok)) return null;

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: dispute.dispute_amount.currency_code }).format(n);
  const rule = `Auto-approved: ${fmt(amount)} is within your ${fmt(settings.autoLimit)} limit and the agent's confidence is ${decision.confidence}.`;
  if (settings.autoMessageBuyer && decision.buyer_message && decision.action === "FIGHT") {
    await sendBuyerMessage(disputeId, decision.buyer_message, true).catch((err) => console.error(`auto message ${disputeId} failed`, err));
  }
  await executeDecision(disputeId, rule);
  return rule;
}
