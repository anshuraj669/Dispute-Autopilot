// Background reactions to dispute events, whether they come from PayPal
// webhooks, the demo "Simulate dispute" button, or the dashboard noticing a
// buyer reply: the agent investigates, then acts alone only if settings allow.

import { after } from "next/server";
import { investigate } from "./agent";
import { maybeActAlone } from "./autopilot";
import { getCase, updateCase } from "./store";
import type { DisputeSummary } from "./types";

// Disputes with a run in flight, so overlapping polls don't start a second one.
const g = globalThis as typeof globalThis & { __intakeBusy?: Set<string> };
const busy = (g.__intakeBusy ??= new Set());

function run(disputeId: string, trigger: string | null) {
  if (busy.has(disputeId)) return;
  busy.add(disputeId);
  after(async () => {
    try {
      // Mark it right away so the dashboard shows the agent working before the first tool call.
      await updateCase(disputeId, (c) => ({ ...c, status: "investigating", error: null, trigger }));
      await investigate(disputeId, trigger);
      await maybeActAlone(disputeId);
    } catch (err) {
      console.error(`investigate ${disputeId} failed`, err);
    } finally {
      busy.delete(disputeId);
    }
  });
}

export function onDisputeCreated(disputeId: string) {
  run(disputeId, null);
}

/** Has the agent reconsider a case, e.g. after the merchant adds evidence. */
export function reinvestigate(disputeId: string, trigger: string) {
  run(disputeId, trigger);
}

/**
 * Re-investigates disputes where the buyer wrote after the agent's last
 * decision. Resolved disputes (e.g. the buyer withdrew) need no new decision.
 */
export async function reactToBuyerReplies(disputes: Pick<DisputeSummary, "id" | "status" | "lastBuyerMessageAt">[]) {
  for (const d of disputes) {
    if (!d.lastBuyerMessageAt || d.status === "RESOLVED" || busy.has(d.id)) continue;
    const record = await getCase(d.id);
    if (!record?.investigatedAt || record.status !== "awaiting_approval") continue;
    if (Date.parse(d.lastBuyerMessageAt) <= Date.parse(record.investigatedAt)) continue;
    run(d.id, "The buyer replied in the dispute thread after your last decision.");
  }
}
