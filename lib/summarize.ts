import type { DisputeSummary } from "./types";

/** Flattens a PayPal dispute-details object for the dashboard. */
export function summarize(d: any): DisputeSummary {
  const txn = d.disputed_transactions?.[0];
  const buyerMessages = (d.messages ?? []).filter((m: any) => m.posted_by === "BUYER");
  return {
    id: d.dispute_id,
    reason: d.reason,
    status: d.status,
    stage: d.dispute_life_cycle_stage ?? "",
    amount: d.dispute_amount,
    createdAt: d.create_time,
    sellerResponseDueDate: d.seller_response_due_date ?? null,
    sellerTransactionId: txn?.seller_transaction_id ?? null,
    buyerName: txn?.buyer?.name ?? null,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    items: (txn?.items ?? []).map((i: any) => ({
      name: i.item_name ?? i.item_id ?? "Unknown item",
      quantity: Number(i.item_quantity ?? 1),
    })),
    firstBuyerMessage: buyerMessages[0]?.content ?? null,
    lastBuyerMessageAt: buyerMessages.at(-1)?.time_posted ?? null,
  };
}
