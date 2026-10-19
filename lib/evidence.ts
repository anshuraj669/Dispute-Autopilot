// Evidence gaps: what PayPal looks for on this kind of claim, what the case
// file already proves, and what's missing. Each missing piece the merchant can
// still collect is priced: how many points it would add to the win estimate
// and what that's worth in expected money, with a collect-by date ahead of
// PayPal's deadline.

import type { CaseFile } from "./casefile";
import { expectedValue, type Assumptions } from "./impact";
import { detectFeatures, scoreWith, type FeatureKey, type Score, type Weights } from "./score";

export type CollectKey = "carrier_pod" | "delivery_photo" | "outside_contact" | "repeat_customer" | "device_match" | "listing_snapshot" | "item_photos";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "have" | "missing" | "collected" | "not_collectable";
  detail: string;
  /** How to get it, for items the merchant can still collect. */
  how?: string;
  collect?: CollectKey;
  /** Win-estimate gain in percentage points if it were added. */
  gainPts?: number;
  /** Expected-value gain in money if it were added. */
  gainUsd?: number;
  facts?: string[];
};

export type Checklist = { items: ChecklistItem[]; collectBy: string | null };

/** Which score feature each collectable item turns on, and the PayPal evidence type it's sent as. */
export const COLLECTABLE: Record<CollectKey, { feature: FeatureKey; label: string; evidenceType: "PROOF_OF_FULFILLMENT" | "ITEM_DESCRIPTION" | "OTHER" }> = {
  carrier_pod: { feature: "carrier_pod", label: "Carrier proof-of-delivery letter", evidenceType: "PROOF_OF_FULFILLMENT" },
  delivery_photo: { feature: "delivery_photo", label: "Delivery photo from the carrier", evidenceType: "PROOF_OF_FULFILLMENT" },
  outside_contact: { feature: "prior_contact", label: "Messages with the buyer outside PayPal", evidenceType: "OTHER" },
  repeat_customer: { feature: "repeat_customer", label: "Earlier orders from this buyer", evidenceType: "OTHER" },
  device_match: { feature: "device_match", label: "Checkout IP or device record", evidenceType: "OTHER" },
  listing_snapshot: { feature: "listing_snapshot", label: "Listing as it was on the order date", evidenceType: "ITEM_DESCRIPTION" },
  item_photos: { feature: "item_photos", label: "Photos of the item as shipped", evidenceType: "ITEM_DESCRIPTION" },
};

const HOW: Record<CollectKey, string> = {
  carrier_pod: "USPS: request Proof of Delivery on the USPS Tracking page. UPS and FedEx: download the proof-of-delivery letter from the tracking page.",
  delivery_photo: "Open the carrier's tracking page; USPS, UPS and FedEx show the delivery photo for 30+ days. Save it as an image.",
  outside_contact: "Emails, Instagram or Etsy messages, or order notes where the buyer talked about this order. Screenshot them with dates visible.",
  repeat_customer: "Order numbers of earlier purchases by the same buyer that weren't disputed, from your store admin.",
  device_match: "From your storefront's order log: the checkout IP or device, compared with the buyer's earlier orders.",
  listing_snapshot: "A screenshot of the listing as it read on the order date: your store's version history or the Wayback Machine.",
  item_photos: "Photos of the item as packed, ideally next to a ruler or a common object for size.",
};

export function buildChecklist(cf: CaseFile, s: Score, w: Weights, a: Assumptions): Checklist {
  const features = detectFeatures(cf);
  const collected = new Set(cf.collected.map((c) => c.key));
  const ev = (p: number) => expectedValue(cf.amount, p, a, cf.reason).fightEdge;
  const items: ChecklistItem[] = [];

  const has = (k: FeatureKey) => features.has(k);
  const facts = (k: FeatureKey) => features.get(k);
  const gain = (k: FeatureKey) => {
    const after = scoreWith(s, k, w);
    return { gainPts: (after - s.p) * 100, gainUsd: Math.max(0, ev(after)) - Math.max(0, ev(s.p)) };
  };
  const auto = (key: string, label: string, ok: boolean, k: FeatureKey | null, yes: string, no: string) =>
    items.push({ key, label, status: ok ? "have" : "not_collectable", detail: ok ? yes : no, facts: k ? facts(k) : undefined });
  const collectable = (c: CollectKey, label: string, yes: string, no: string) => {
    const k = COLLECTABLE[c].feature;
    if (has(k)) items.push({ key: c, label, status: collected.has(c) ? "collected" : "have", detail: yes, facts: facts(k) });
    else items.push({ key: c, label, status: "missing", detail: no, how: HOW[c], collect: c, ...gain(k) });
  };

  const delivered = cf.tracking.find((t) => t.status === "DELIVERED");
  const g = s.group;
  if (g === "NR" || g === "UA") {
    auto("tracking", "Tracking number on the order", cf.trackers.length > 0, null,
      cf.trackers.map((t) => `${t.carrier ?? ""} ${t.number}`.trim()).join(", "),
      "No tracking was added to the PayPal order. Add tracking when you ship next time; without it, \"not received\" claims are almost always lost.");
    auto("delivered", "Carrier delivery to the ship-to address", has("delivered_to_address"), "delivered_to_address",
      `Delivered ${delivered?.delivered_at ? new Date(delivered.delivered_at).toLocaleDateString("en-US") : ""}${delivered?.delivery_location ? ` at ${delivered.delivery_location}` : ""}.`,
      delivered ? "The carrier's delivery location doesn't match the order's ship-to address." : cf.trackers.length ? `Carrier status: ${cf.tracking[0]?.status ?? "unknown"}.` : "Nothing to check without tracking.");
    auto("signature", "Signature on delivery", has("signature"), "signature",
      `Signed by ${cf.tracking.find((t) => t.signature)?.signature}.`,
      cf.amount >= 750 ? "PayPal Seller Protection needs signature confirmation on orders of $750 or more. Require it on large orders." : "Can't be added after delivery. Consider signature confirmation on larger orders.");
  }
  // Nothing to prove delivery of if it was never shipped with tracking.
  if (g === "NR" && cf.trackers.length) {
    collectable("delivery_photo", "Delivery photo", "The carrier took a photo on delivery.", "No delivery photo in the carrier data yet.");
    collectable("carrier_pod", "Carrier proof-of-delivery letter", "Added.", "An official letter from the carrier confirming delivery and the address.");
  }
  if (g === "UA") {
    collectable("outside_contact", "Buyer talked about the order beforehand", "The buyer wrote about this order before disputing it.", "No earlier messages from the buyer in the PayPal thread.");
    collectable("repeat_customer", "Earlier undisputed orders", "Added.", "Shows the buyer knows your shop.");
    collectable("device_match", "Checkout IP or device match", "Added.", "Shows the payment came from the buyer's usual device.");
  }
  if (g === "SNAD") {
    collectable("listing_snapshot", "Listing on the order date", "Added.", "Shows what the buyer saw when they paid.");
    collectable("item_photos", "Photos of the item as shipped", "Added.", "Shows the item matched the listing when it left.");
    auto("policy", "Refund policy", Boolean(cf.refundPolicy), null, cf.refundPolicy ?? "", "Add your refund policy in Settings.");
  }
  if (g === "NR" || g === "UA") {
    auto("protection", "PayPal Seller Protection", has("protection_eligible"), "protection_eligible", "The payment is eligible.", `Status: ${cf.protection ?? "unknown"}.`);
  }

  // Ask for it a day before PayPal's deadline so there's time to submit.
  const collectBy = cf.dueAt ? new Date(Date.parse(cf.dueAt) - 86_400_000).toISOString() : null;
  return { items, collectBy };
}
