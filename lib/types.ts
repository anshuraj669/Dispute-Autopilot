// Shared types for disputes, agent decisions and the action log.

export type Money = { currency_code: string; value: string };

/** Flattened view of a PayPal dispute, used by the dashboard grid. */
export type DisputeSummary = {
  id: string;
  reason: string;
  status: string;
  stage: string;
  amount: Money;
  createdAt: string;
  sellerResponseDueDate: string | null;
  sellerTransactionId: string | null;
  buyerName: string | null;
  outcome: string | null;
  items: { name: string; quantity: number }[];
  firstBuyerMessage: string | null;
  lastBuyerMessageAt: string | null;
};

export const EVIDENCE_TYPES = [
  "PROOF_OF_FULFILLMENT",
  "PROOF_OF_REFUND",
  "PROOF_OF_DELIVERY_SIGNATURE",
  "PROOF_OF_RECEIPT_COPY",
  "RETURN_POLICY",
  "BILLING_AGREEMENT",
  "PROOF_OF_RESHIPMENT",
  "ITEM_DESCRIPTION",
  "POLICE_REPORT",
  "AFFIDAVIT",
  "PAID_WITH_OTHER_METHOD",
  "COPY_OF_CONTRACT",
  "TERMINAL_ATM_RECEIPT",
  "PRICE_DIFFERENCE_REASON",
  "SOURCE_CONVERSION_RATE",
  "BANK_STATEMENT",
  "CREDIT_DUE_REASON",
  "REQUEST_CREDIT_RECEIPT",
  "PROOF_OF_RETURN",
  "CREATE",
  "CHANGE_REASON",
  "OTHER",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceItem = {
  evidence_type: EvidenceType;
  description: string;
  carrier?: string;
  tracking_number?: string;
  /** Case-file fact IDs this evidence rests on (see lib/casefile.ts). */
  sources?: string[];
};

/** What the agent recommends after investigating a dispute. */
export type Decision = {
  action: "FIGHT" | "ACCEPT";
  /** The calibrated model's estimate (lib/score.ts), not the LLM's guess. */
  win_probability: number;
  /** The agent's own read, kept for comparison with the calibrated model. */
  agent_estimate?: number;
  /** Why the agent's read differs from the calibrated estimate, if it does. */
  deviation_reason?: string | null;
  confidence: "low" | "medium" | "high";
  headline: string;
  reasoning: string[];
  evidence: EvidenceItem[];
  seller_statement: string;
  buyer_message: string;
  listing_insight: string | null;
};

export type ToolCall = { tool: string; input: unknown; ok: boolean; at: string; error?: string };

export type Execution = {
  action: "FIGHT" | "ACCEPT";
  at: string;
  ok: boolean;
  detail: string;
  /** Set when the agent acted on its own under the merchant's autonomy rules. */
  auto?: string | null;
  /** Files attached to the PayPal submission. */
  documents?: string[];
};

/** The calibrated estimate frozen at decision time, so it can be scored against the outcome later. */
export type Prediction = {
  p: number;
  group: string;
  /** Weight keys that were active, e.g. "NR.delivered_to_address". */
  features: string[];
  model: string;
  agentEstimate: number | null;
  at: string;
};

/** Proof the merchant added by hand (a note, optionally a file). */
export type CollectedEvidence = {
  key: string;
  note: string;
  at: string;
  /** `path` is relative to data/uploads. */
  file?: { name: string; type: string; size: number; sha256: string; path: string };
};

export type SentMessage = { at: string; content: string; auto?: boolean };

export type CaseRecord = {
  disputeId: string;
  status: "investigating" | "awaiting_approval" | "executed" | "failed";
  decision: Decision | null;
  toolCalls: ToolCall[];
  investigatedAt: string | null;
  error: string | null;
  execution: Execution | null;
  /** Messages the merchant (or the agent, when allowed) sent to the buyer. */
  messages?: SentMessage[];
  /** Why the latest investigation ran, e.g. a buyer reply. */
  trigger?: string | null;
  prediction?: Prediction | null;
  collected?: CollectedEvidence[];
};
