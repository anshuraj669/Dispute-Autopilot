// Hand-built case files and records for unit tests, so the scoring and
// integrity rules can be checked without PayPal or the mock provider.

import type { CaseFile, Fact } from "@/lib/casefile";
import type { Assumptions } from "@/lib/impact";
import type { CaseRecord, Decision, DisputeSummary } from "@/lib/types";

const DAY = 86_400_000;
export const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
export const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const fact = (id: string): Fact => ({ id, label: id, value: "x", source: "test", at: null });

/** A delivered "not received" case to the ship-to address; override what a test needs. */
export function caseFile(over: Partial<CaseFile> = {}): CaseFile {
  const base: CaseFile = {
    disputeId: "T-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amount: 86,
    currency: "USD",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    createdAt: ago(2),
    dueAt: ahead(8),
    captureAmount: 86,
    paidAt: ago(16),
    protection: null,
    payer: { name: "Sophie Carter", zip: "97205", line1: "41 Elm St", address: "41 Elm St, Portland, OR, 97205, US" },
    shipTo: { name: "Sophie Carter", zip: "97205", line1: "41 Elm St", address: "41 Elm St, Portland, OR, 97205, US" },
    items: [{ name: "Cedar & Smoke Candle Trio", sku: "CS-TRIO", quantity: 1, unit: 86 }],
    trackers: [{ number: "9400111899223344550011", carrier: "USPS", shippedAt: ago(15), fact: "tracker.1" }],
    tracking: [
      {
        source: "simulated",
        carrier: "USPS",
        tracking_number: "9400111899223344550011",
        status: "DELIVERED",
        delivered_at: ago(12),
        delivery_location: "Front porch, Portland OR 97205",
        fact: "carrier.1.status",
      },
    ],
    messages: [],
    sameComplaints: 0,
    refundPolicy: null,
    collected: [],
    facts: [],
    sources: [],
    builtAt: new Date().toISOString(),
    dispute: {},
  };
  const cf = { ...base, ...over };
  if (!over.facts) {
    const ids = ["dispute.reason", "dispute.amount", "payment.capture", "order.payer", "order.ship_to"];
    ids.push(...cf.trackers.map((t) => t.fact), ...cf.tracking.map((t) => t.fact), ...cf.messages.map((m) => m.fact));
    ids.push(...cf.collected.map((c) => `merchant.${c.key}`));
    cf.facts = ids.map(fact);
  }
  return cf;
}

export function decision(over: Partial<Decision> = {}): Decision {
  return {
    action: "FIGHT",
    win_probability: 0.7,
    confidence: "high",
    headline: "Fight it",
    reasoning: ["Carrier confirms delivery."],
    evidence: [
      {
        evidence_type: "PROOF_OF_FULFILLMENT",
        description: "USPS delivered to the ship-to address.",
        carrier: "USPS",
        tracking_number: "9400111899223344550011",
        sources: ["carrier.1.status", "order.ship_to"],
      },
    ],
    seller_statement: "USPS 9400111899223344550011 shows delivery of the $86.00 order to the buyer's address.",
    buyer_message: "Hi, tracking shows delivery to your porch.",
    listing_insight: null,
    ...over,
  };
}

export const assumptionsFixture = (over: Partial<Assumptions> = {}): Assumptions => ({
  disputeFee: 15,
  feeWhen: "lost",
  manualMinutes: 45,
  hourlyRate: 30,
  reviewMinutes: 10,
  returnRecoveryPct: 50,
  ...over,
});

export function summary(over: Partial<DisputeSummary> = {}): DisputeSummary {
  return {
    id: "T-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    amount: { currency_code: "USD", value: "100.00" },
    createdAt: ago(2),
    sellerResponseDueDate: ahead(8),
    sellerTransactionId: "CAP-1",
    buyerName: "Sophie Carter",
    outcome: null,
    items: [{ name: "Candle", quantity: 1 }],
    firstBuyerMessage: null,
    lastBuyerMessageAt: null,
    ...over,
  };
}

export function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    disputeId: "T-1",
    status: "awaiting_approval",
    decision: decision(),
    toolCalls: [],
    investigatedAt: ago(1),
    error: null,
    execution: null,
    ...over,
  };
}
