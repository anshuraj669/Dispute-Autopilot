// The case file: every fact the decision engine, the agent and the evidence
// packet may rely on, each tied to the source record it came from. Source
// records are fingerprinted (SHA-256) and timestamped when fetched, so a
// reviewer can tell exactly what the merchant's submission rests on.

import { createHash } from "crypto";
import { trackShipment, type TrackingResult } from "./carrier";
import { provider } from "./paypal";
import { SHIPPING_CARRIER } from "./products";
import { getSettings } from "./settings";
import { getCase } from "./store";
import { money, reasonLabel } from "./format";
import type { CollectedEvidence, DisputeSummary } from "./types";

export type Source = {
  id: string;
  label: string;
  /** Where the record came from, e.g. the API path. */
  ref: string;
  fetchedAt: string;
  sha256: string;
};

export type Fact = {
  id: string;
  label: string;
  value: string;
  source: string;
  /** The time the record itself states (a scan, a message), when it has one. */
  at: string | null;
};

export type Party = { name: string | null; zip: string | null; line1: string | null; address: string | null };

export type CaseFile = {
  disputeId: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  stage: string;
  createdAt: string;
  dueAt: string | null;
  captureAmount: number | null;
  paidAt: string | null;
  protection: string | null;
  payer: Party | null;
  shipTo: Party | null;
  items: { name: string; sku: string | null; quantity: number; unit: number | null }[];
  trackers: { number: string; carrier: string | null; shippedAt: string | null; fact: string }[];
  tracking: (TrackingResult & { fact: string })[];
  messages: { by: "BUYER" | "SELLER"; at: string; content: string; fact: string }[];
  /** Other disputes on the same product for the same reason. */
  sameComplaints: number;
  refundPolicy: string | null;
  collected: CollectedEvidence[];
  facts: Fact[];
  sources: Source[];
  builtAt: string;
  /** The raw PayPal dispute, for permission checks and the page. */
  dispute: any;
};

const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

const zipOf = (s: string | null | undefined) => s?.match(/\b\d{5}(?:-\d{4})?\b/g)?.at(-1)?.slice(0, 5) ?? null;

const addressLine = (a: any) =>
  a ? [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ") : null;

function party(name: string | null | undefined, a: any): Party | null {
  if (!name && !a) return null;
  return { name: name ?? null, zip: a?.postal_code?.slice(0, 5) ?? null, line1: a?.address_line_1 ?? null, address: addressLine(a) };
}

/** Order ID from a capture: mock fixtures carry it directly, PayPal links to it. */
export function orderIdOf(capture: any): string | null {
  const direct = capture?.supplementary_data?.related_ids?.order_id;
  if (direct) return direct;
  const up = capture?.links?.find((l: any) => l.rel === "up")?.href as string | undefined;
  return up?.match(/\/orders\/([^/?]+)/)?.[1] ?? null;
}

export const deliveredZip = (t: TrackingResult) => zipOf(t.delivery_location);

/** `disputes` can be passed in when the caller already listed them. */
export async function buildCaseFile(disputeId: string, disputes?: DisputeSummary[]): Promise<CaseFile> {
  const paypal = provider();
  const now = () => new Date().toISOString();
  const [dispute, record, settings, list] = await Promise.all([
    paypal.getDispute(disputeId),
    getCase(disputeId),
    getSettings(),
    disputes ? Promise.resolve(disputes) : paypal.listDisputes(),
  ]);
  const sources: Source[] = [];
  const facts: Fact[] = [];
  const fact = (id: string, label: string, value: string | null | undefined, source: string, at: string | null = null) => {
    if (value) facts.push({ id, label, value, source, at });
    return id;
  };

  sources.push({ id: "paypal.dispute", label: "PayPal dispute record", ref: `GET /v1/customer/disputes/${disputeId}`, fetchedAt: now(), sha256: sha(dispute) });
  const txn = dispute.disputed_transactions?.[0];
  fact("dispute.reason", "Buyer's claim", reasonLabel(dispute.reason), "paypal.dispute", dispute.create_time);
  fact("dispute.amount", "Amount disputed", money(dispute.dispute_amount), "paypal.dispute");
  fact("dispute.status", "Dispute status", `${dispute.status}${dispute.dispute_life_cycle_stage ? ` (${dispute.dispute_life_cycle_stage})` : ""}`, "paypal.dispute");
  fact("dispute.due", "Seller response due", dispute.seller_response_due_date, "paypal.dispute", dispute.seller_response_due_date ?? null);

  const capture = txn?.seller_transaction_id ? await paypal.getCapture(txn.seller_transaction_id).catch(() => null) : null;
  if (capture) {
    sources.push({ id: "paypal.capture", label: "PayPal payment capture", ref: `GET /v2/payments/captures/${capture.id}`, fetchedAt: now(), sha256: sha(capture) });
    fact("payment.capture", "Payment", `${money(capture.amount)} captured, ${capture.status}, ID ${capture.id}`, "paypal.capture", capture.create_time ?? null);
    fact("payment.protection", "Seller Protection", capture.seller_protection?.status, "paypal.capture");
  }

  const orderId = orderIdOf(capture);
  const order = orderId ? await paypal.getOrder(orderId).catch(() => null) : null;
  const unit = order?.purchase_units?.[0];
  let payer: Party | null = null;
  let shipTo: Party | null = null;
  const trackers: CaseFile["trackers"] = [];
  if (order) {
    sources.push({ id: "paypal.order", label: "PayPal checkout order", ref: `GET /v2/checkout/orders/${order.id}`, fetchedAt: now(), sha256: sha(order) });
    const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ") || null;
    payer = party(payerName, order.payer?.address);
    shipTo = party(unit?.shipping?.name?.full_name, unit?.shipping?.address);
    fact("order.payer", "Payer", [payerName, order.payer?.email_address, payer?.address].filter(Boolean).join(" · "), "paypal.order");
    fact("order.ship_to", "Shipped to", [shipTo?.name, shipTo?.address].filter(Boolean).join(", "), "paypal.order");
    (unit?.items ?? []).forEach((i: any, k: number) =>
      fact(`order.item.${k + 1}`, "Item", `${i.quantity} × ${i.name}${i.sku ? ` (SKU ${i.sku})` : ""} at ${money(i.unit_amount)}`, "paypal.order"),
    );
    (unit?.shipping?.trackers ?? []).forEach((t: any, k: number) => {
      const number = t.tracking_number ?? String(t.id ?? "").split("-").slice(1).join("-");
      if (!number) return;
      // PayPal's tracker omits the carrier; the demo store ships everything with one.
      const carrier = t.carrier ?? SHIPPING_CARRIER;
      const id = fact(`tracker.${k + 1}`, "Tracking on the order", `${carrier} ${number}`, "paypal.order", t.create_time ?? null);
      trackers.push({ number, carrier, shippedAt: t.create_time ?? null, fact: id });
    });
  }

  const tracking = await Promise.all(
    trackers.map(async (t, k) => {
      const result = await trackShipment(t.number, t.carrier, paypal.mode).catch(
        (err): TrackingResult => ({ source: "none", carrier: t.carrier, tracking_number: t.number, status: "UNKNOWN", note: String(err) }),
      );
      const src = `carrier.${k + 1}`;
      const label = result.source === "shippo" ? "Carrier tracking via Shippo" : result.source === "simulated" ? "Carrier tracking (simulated, demo)" : "Carrier lookup (not configured)";
      sources.push({ id: src, label, ref: `${result.carrier ?? "carrier"} ${t.number}`, fetchedAt: now(), sha256: sha(result) });
      const id = fact(
        `carrier.${k + 1}.status`,
        "Carrier status",
        [result.status, result.delivery_location && `at ${result.delivery_location}`, result.note].filter(Boolean).join(" "),
        src,
        result.delivered_at ?? null,
      );
      fact(`carrier.${k + 1}.signature`, "Signed for by", result.signature, src, result.delivered_at ?? null);
      fact(`carrier.${k + 1}.photo`, "Delivery photo", result.photo_on_delivery ? "Carrier took a photo on delivery" : null, src, result.delivered_at ?? null);
      return { ...result, fact: id };
    }),
  );

  const messages: CaseFile["messages"] = (dispute.messages ?? []).map((m: any, k: number) => {
    const by = m.posted_by === "SELLER" ? "SELLER" : "BUYER";
    const content = String(m.content ?? "");
    const id = fact(`message.${k + 1}`, by === "BUYER" ? "Buyer wrote" : "Seller wrote", content.length > 400 ? `${content.slice(0, 400)}…` : content, "paypal.dispute", m.time_posted ?? null);
    return { by, at: m.time_posted, content, fact: id };
  });

  // Other disputes about the same product for the same reason.
  const names = new Set<string>((txn?.items ?? []).map((i: any) => i.item_name ?? i.item_id).filter(Boolean));
  const same = list.filter((d) => d.id !== disputeId && d.reason === dispute.reason && d.items.some((i) => names.has(i.name)));
  if (list.length) {
    sources.push({ id: "paypal.disputes", label: "Merchant's dispute history", ref: "GET /v1/customer/disputes", fetchedAt: now(), sha256: sha(list.map((d) => [d.id, d.status, d.outcome])) });
    fact("history.same_complaint", "Same complaint, same product", same.length ? `${same.length} other dispute(s): ${same.map((d) => d.id).join(", ")}` : "None", "paypal.disputes");
  }

  const policy = settings.refundPolicy && settings.refundPolicy !== "Not provided" ? settings.refundPolicy : null;
  if (policy) {
    sources.push({ id: "merchant.settings", label: "Merchant's refund policy (Settings)", ref: "Settings page", fetchedAt: now(), sha256: sha(policy) });
    fact("policy.refund", "Refund policy", policy, "merchant.settings");
  }

  const collected = record?.collected ?? [];
  for (const c of collected) {
    const src = `merchant.${c.key}`;
    sources.push({
      id: src,
      label: `Added by the merchant${c.file ? `: ${c.file.name}` : ""}`,
      ref: c.file ? `upload ${c.file.name} (${Math.round(c.file.size / 1024)} KB)` : "note",
      fetchedAt: c.at,
      sha256: c.file?.sha256 ?? sha(c.note),
    });
    fact(`merchant.${c.key}`, "Merchant supplied", c.note || c.file?.name, src, c.at);
  }

  return {
    disputeId,
    reason: dispute.reason,
    amount: Number(dispute.dispute_amount?.value ?? 0),
    currency: dispute.dispute_amount?.currency_code ?? "USD",
    status: dispute.status,
    stage: dispute.dispute_life_cycle_stage ?? "",
    createdAt: dispute.create_time,
    dueAt: dispute.seller_response_due_date ?? null,
    captureAmount: capture?.amount ? Number(capture.amount.value) : null,
    paidAt: capture?.create_time ?? txn?.create_time ?? null,
    protection: capture?.seller_protection?.status ?? null,
    payer,
    shipTo,
    items: (unit?.items ?? txn?.items ?? []).map((i: any) => ({
      name: i.name ?? i.item_name ?? "Item",
      sku: i.sku ?? null,
      quantity: Number(i.quantity ?? i.item_quantity ?? 1),
      unit: i.unit_amount ? Number(i.unit_amount.value) : null,
    })),
    trackers,
    tracking,
    messages,
    sameComplaints: same.length,
    refundPolicy: policy,
    collected,
    facts,
    sources,
    builtAt: now(),
    dispute,
  };
}

/** The compact form the agent reads: facts with IDs to cite, and where each came from. */
export function caseFileForAgent(cf: CaseFile) {
  return {
    facts: cf.facts.map((f) => ({ id: f.id, label: f.label, value: f.value, recorded_at: f.at, source: f.source })),
    sources: cf.sources.map((s) => ({ id: s.id, label: s.label, fetched_at: s.fetchedAt })),
  };
}
