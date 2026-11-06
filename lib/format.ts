import type { Money } from "./types";

export const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Canceled subscription",
  PROBLEM_WITH_REMITTANCE: "Remittance problem",
  OTHER: "Other",
};

export const reasonLabel = (r: string) => REASONS[r] ?? r;

/** Plain-English names for the agent's tools, as shown in its trace. */
export const TOOL_LABELS: Record<string, string> = {
  get_case_file: "Read the sourced case file",
  get_dispute: "Read the dispute",
  get_capture: "Looked up the payment",
  get_order: "Opened the order",
  search_transaction: "Checked the transaction record",
  check_carrier_status: "Checked carrier tracking",
  list_merchant_disputes: "Compared with past disputes",
  get_merchant_policy: "Read your refund policy",
  record_decision: "Recorded a decision",
};

export const money = (m: Money | null | undefined) =>
  m ? new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency_code }).format(Number(m.value)) : "";

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export const humanStatus = (s: string) => s.toLowerCase().replace(/_/g, " ");
