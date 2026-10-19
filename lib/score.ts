// Calibrated win estimate: a small logistic model over facts in the case file,
// not a number the LLM makes up. Every point of the estimate traces to a named
// factor. Starting weights encode PayPal Seller Protection rules (delivery
// proof decides "not received", prior contact matters for "unauthorized");
// lib/learning.ts then refits them on resolved disputes and reports how well
// the estimates matched what PayPal actually decided.

import { deliveredZip, type CaseFile } from "./casefile";

export type Group = "NR" | "UA" | "SNAD" | "OTHER";

export const GROUP_LABELS: Record<Group, string> = {
  NR: "Item not received",
  UA: "Unauthorized",
  SNAD: "Not as described",
  OTHER: "Other reasons",
};

export function groupOf(reason: string): Group {
  if (reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") return "NR";
  if (reason === "UNAUTHORISED") return "UA";
  if (reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED") return "SNAD";
  return "OTHER";
}

export type FeatureKey =
  | "delivered_to_address"
  | "delivered_elsewhere"
  | "no_tracking"
  | "signature"
  | "delivery_photo"
  | "carrier_pod"
  | "protection_eligible"
  | "high_value_no_signature"
  | "prior_contact"
  | "ship_to_other"
  | "repeat_customer"
  | "device_match"
  | "listing_snapshot"
  | "item_photos"
  | "repeat_complaints";

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  delivered_to_address: "Carrier confirms delivery to the ship-to address",
  delivered_elsewhere: "Carrier delivered somewhere other than the ship-to address",
  no_tracking: "No tracking on the order",
  signature: "Signed for on delivery",
  delivery_photo: "Carrier delivery photo",
  carrier_pod: "Carrier proof-of-delivery letter",
  protection_eligible: "Eligible for PayPal Seller Protection",
  high_value_no_signature: "$750 or more without a signature",
  prior_contact: "Buyer discussed the order before disputing",
  ship_to_other: "Shipped to someone other than the payer",
  repeat_customer: "Buyer has earlier undisputed orders",
  device_match: "Checkout device or IP matches the buyer's history",
  listing_snapshot: "Listing as it was on the order date",
  item_photos: "Photos of the item as shipped",
  repeat_complaints: "Other buyers made the same complaint about this product",
};

/** Weight keys are "GROUP.feature" plus "GROUP.base" for the starting log-odds. */
export type Weights = Record<string, number>;

export const PRIOR: Weights = {
  "NR.base": -1.5,
  "NR.delivered_to_address": 2.3,
  "NR.delivered_elsewhere": -1.0,
  "NR.no_tracking": -1.5,
  "NR.signature": 0.7,
  "NR.delivery_photo": 0.4,
  "NR.carrier_pod": 0.4,
  "NR.protection_eligible": 0.3,
  "NR.high_value_no_signature": -1.2,
  "UA.base": -1.2,
  "UA.delivered_to_address": 0.8,
  "UA.no_tracking": -0.8,
  "UA.signature": 0.6,
  "UA.prior_contact": 1.2,
  "UA.ship_to_other": -0.6,
  "UA.repeat_customer": 0.6,
  "UA.device_match": 0.6,
  "UA.protection_eligible": 0.4,
  "SNAD.base": -1.0,
  "SNAD.listing_snapshot": 0.6,
  "SNAD.item_photos": 0.6,
  "SNAD.repeat_complaints": -0.9,
  "OTHER.base": -1.0,
};

/** Features that count for a group, i.e. have a weight in it. */
export const featuresFor = (g: Group) =>
  Object.keys(PRIOR)
    .filter((k) => k.startsWith(`${g}.`) && !k.endsWith(".base"))
    .map((k) => k.split(".")[1] as FeatureKey);

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const surname = (s: string | null | undefined) => s?.trim().split(/\s+/).at(-1)?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";

/** Which facts hold for this case, with the fact IDs that show each one. */
export function detectFeatures(cf: CaseFile): Map<FeatureKey, string[]> {
  const on = new Map<FeatureKey, string[]>();
  const have = (k: FeatureKey, facts: string[]) => on.set(k, facts);
  const collected = (key: string) => cf.collected.find((c) => c.key === key);

  const delivered = cf.tracking.filter((t) => t.status === "DELIVERED");
  const shipZip = cf.shipTo?.zip ?? null;
  const toAddress = delivered.filter((t) => shipZip && deliveredZip(t) === shipZip);
  if (toAddress.length) have("delivered_to_address", [...toAddress.map((t) => t.fact), "order.ship_to"]);
  const elsewhere = delivered.filter((t) => shipZip && deliveredZip(t) && deliveredZip(t) !== shipZip);
  if (elsewhere.length && !toAddress.length) have("delivered_elsewhere", [...elsewhere.map((t) => t.fact), "order.ship_to"]);
  if (!cf.trackers.length) have("no_tracking", cf.facts.some((f) => f.id === "order.ship_to") ? ["order.ship_to"] : []);

  const signed = cf.tracking.filter((t) => t.signature);
  if (signed.length) have("signature", signed.map((t) => t.fact.replace(".status", ".signature")));
  const photo = cf.tracking.filter((t) => t.photo_on_delivery);
  if (photo.length) have("delivery_photo", photo.map((t) => t.fact.replace(".status", ".photo")));
  else if (collected("delivery_photo")) have("delivery_photo", ["merchant.delivery_photo"]);
  if (collected("carrier_pod")) have("carrier_pod", ["merchant.carrier_pod"]);
  if (cf.protection === "ELIGIBLE") have("protection_eligible", ["payment.protection"]);
  if (cf.amount >= 750 && !signed.length) have("high_value_no_signature", ["dispute.amount"]);

  // Buyer messages written before the dispute was opened.
  const opened = Date.parse(cf.createdAt) - 60 * 60 * 1000;
  const before = cf.messages.filter((m) => m.by === "BUYER" && Date.parse(m.at) < opened);
  if (before.length) have("prior_contact", before.map((m) => m.fact));
  else if (collected("outside_contact")) have("prior_contact", ["merchant.outside_contact"]);

  const payerDiffers =
    cf.payer && cf.shipTo && ((cf.payer.zip && cf.shipTo.zip && cf.payer.zip !== cf.shipTo.zip) || surname(cf.payer.name) !== surname(cf.shipTo.name));
  if (payerDiffers) have("ship_to_other", ["order.payer", "order.ship_to"]);
  if (collected("repeat_customer")) have("repeat_customer", ["merchant.repeat_customer"]);
  if (collected("device_match")) have("device_match", ["merchant.device_match"]);
  if (collected("listing_snapshot")) have("listing_snapshot", ["merchant.listing_snapshot"]);
  if (collected("item_photos")) have("item_photos", ["merchant.item_photos"]);
  if (cf.sameComplaints > 0) have("repeat_complaints", ["history.same_complaint"]);
  return on;
}

export type Factor = {
  key: FeatureKey;
  label: string;
  weight: number;
  /** Percentage points this factor moves the estimate, holding the others as they are. */
  points: number;
  facts: string[];
};

export type Score = {
  p: number;
  group: Group;
  baseP: number;
  factors: Factor[];
  /** Active weight keys, frozen into the prediction for later learning. */
  active: string[];
  model: string;
};

export function scoreFeatures(group: Group, features: Iterable<FeatureKey>, w: Weights): number {
  let z = w[`${group}.base`] ?? 0;
  for (const f of features) z += w[`${group}.${f}`] ?? 0;
  return sigmoid(z);
}

export function score(cf: CaseFile, w: Weights, model: string): Score {
  const group = groupOf(cf.reason);
  const detected = detectFeatures(cf);
  const applicable = new Set(featuresFor(group));
  const active = [...detected.keys()].filter((k) => applicable.has(k));
  const p = scoreFeatures(group, active, w);
  const factors = active
    .map((key) => ({
      key,
      label: FEATURE_LABELS[key],
      weight: w[`${group}.${key}`] ?? 0,
      points: (p - scoreFeatures(group, active.filter((k) => k !== key), w)) * 100,
      facts: detected.get(key) ?? [],
    }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { p, group, baseP: scoreFeatures(group, [], w), factors, active: active.map((k) => `${group}.${k}`), model };
}

/** The estimate if one more factor were true: how much a piece of missing evidence is worth. */
export function scoreWith(s: Score, extra: FeatureKey, w: Weights): number {
  const active = s.active.map((k) => k.split(".")[1] as FeatureKey);
  if (active.includes(extra)) return s.p;
  return scoreFeatures(s.group, [...active, extra], w);
}
