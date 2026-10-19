// Fixture data shaped like PayPal sandbox responses, so the app runs end-to-end
// without PayPal credentials (PAYPAL_MODE=mock). Dates are relative to "now" so
// response deadlines always look live.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import type { DisputeProvider } from "./paypal";
import type { EvidenceItem } from "./types";
import { summarize } from "./summarize";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const usd = (value: string) => ({ currency_code: "USD", value });
const SELLER = { merchant_id: "LUMENCANDLE01", name: "Lumen Candle Co." };

/** How the simulated buyer answers the first message the seller sends. */
type Reply = { content: string; withdraws: boolean };

type Fixture = {
  dispute: any;
  capture: any;
  order: any;
  transaction: any;
  reply?: Reply;
  /** Set when the seller messages; the reply shows up once this time passes. */
  replyAt?: number;
};

const REPLY_DELAY_MS = 8_000;

function fixture(opts: {
  disputeId: string;
  captureId: string;
  orderId: string;
  reason: string;
  status?: string;
  amount: string;
  buyer: { name: string; email: string; address: any };
  shipTo?: { name: string; address: any };
  items: { name: string; sku: string; quantity: number; unit: string }[];
  paidDaysAgo: number;
  openedDaysAgo: number;
  dueInDays: number | null;
  messages: { by: "BUYER" | "SELLER"; daysAgo: number; content: string }[];
  trackers?: { carrier: string; tracking_number: string; shippedDaysAgo: number }[];
  outcome?: string;
  reply?: Reply;
}): Fixture {
  const shipTo = opts.shipTo ?? { name: opts.buyer.name, address: opts.buyer.address };
  const items = opts.items.map((i) => ({
    name: i.name,
    sku: i.sku,
    quantity: String(i.quantity),
    unit_amount: usd(i.unit),
  }));
  return {
    reply: opts.reply,
    dispute: {
      dispute_id: opts.disputeId,
      create_time: ago(opts.openedDaysAgo),
      update_time: ago(Math.max(opts.openedDaysAgo - 1, 0)),
      disputed_transactions: [
        {
          seller_transaction_id: opts.captureId,
          buyer_transaction_id: `B-${opts.captureId}`,
          create_time: ago(opts.paidDaysAgo),
          transaction_status: "COMPLETED",
          gross_amount: usd(opts.amount),
          buyer: { name: opts.buyer.name },
          seller: SELLER,
          items: opts.items.map((i) => ({ item_name: i.name, item_quantity: String(i.quantity) })),
        },
      ],
      reason: opts.reason,
      status: opts.status ?? "WAITING_FOR_SELLER_RESPONSE",
      dispute_amount: usd(opts.amount),
      seller_response_due_date: opts.dueInDays === null ? null : ahead(opts.dueInDays),
      dispute_life_cycle_stage: "INQUIRY",
      dispute_channel: "INTERNAL",
      messages: opts.messages.map((m) => ({ posted_by: m.by, time_posted: ago(m.daysAgo), content: m.content })),
      ...(opts.outcome ? { dispute_outcome: { outcome_code: opts.outcome } } : {}),
    },
    capture: {
      id: opts.captureId,
      status: "COMPLETED",
      amount: usd(opts.amount),
      create_time: ago(opts.paidDaysAgo),
      supplementary_data: { related_ids: { order_id: opts.orderId } },
      seller_protection: {
        status: "ELIGIBLE",
        dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"],
      },
    },
    order: {
      id: opts.orderId,
      status: "COMPLETED",
      create_time: ago(opts.paidDaysAgo),
      payer: {
        name: { given_name: opts.buyer.name.split(" ")[0], surname: opts.buyer.name.split(" ").slice(1).join(" ") },
        email_address: opts.buyer.email,
        address: opts.buyer.address,
      },
      purchase_units: [
        {
          amount: usd(opts.amount),
          items,
          shipping: {
            name: { full_name: shipTo.name },
            address: shipTo.address,
            trackers: (opts.trackers ?? []).map((t) => ({
              id: `${opts.captureId}-${t.tracking_number}`,
              status: "SHIPPED",
              carrier: t.carrier,
              tracking_number: t.tracking_number,
              create_time: ago(t.shippedDaysAgo),
            })),
          },
          payments: { captures: [{ id: opts.captureId, status: "COMPLETED", amount: usd(opts.amount) }] },
        },
      ],
    },
    transaction: {
      transaction_details: [
        {
          transaction_info: {
            transaction_id: opts.captureId,
            transaction_initiation_date: ago(opts.paidDaysAgo),
            transaction_amount: usd(opts.amount),
            transaction_status: "S",
          },
          payer_info: {
            email_address: opts.buyer.email,
            payer_status: "Y",
            address_status: "Y",
            payer_name: { alternate_full_name: opts.buyer.name },
          },
          shipping_info: { name: shipTo.name, address: shipTo.address },
          cart_info: {
            item_details: opts.items.map((i) => ({ item_code: i.sku, item_name: i.name, item_quantity: String(i.quantity) })),
          },
        },
      ],
    },
  };
}

const addr = (line1: string, city: string, state: string, zip: string) => ({
  address_line_1: line1,
  admin_area_2: city,
  admin_area_1: state,
  postal_code: zip,
  country_code: "US",
});

const BUILT_IN: Fixture[] = [
  fixture({
    disputeId: "PP-D-1001",
    captureId: "3MB91234XK001",
    orderId: "5O190127TN001",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amount: "86.00",
    buyer: { name: "Sophie Carter", email: "sophie.carter@example.com", address: addr("41 Elm St", "Portland", "OR", "97205") },
    items: [{ name: "Cedar & Smoke Candle Trio", sku: "CS-TRIO", quantity: 1, unit: "86.00" }],
    paidDaysAgo: 16,
    openedDaysAgo: 2,
    dueInDays: 8,
    messages: [{ by: "BUYER", daysAgo: 2, content: "It's been over two weeks and my candles never showed up. I want a refund." }],
    trackers: [{ carrier: "USPS", tracking_number: "9400111899223344550011", shippedDaysAgo: 15 }],
    reply: { content: "Oh no, I'm so sorry! My neighbour took it in by mistake and just dropped it off. I'm closing the case now.", withdraws: true },
  }),
  fixture({
    disputeId: "PP-D-1002",
    captureId: "3MB91234XK002",
    orderId: "5O190127TN002",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amount: "12.50",
    buyer: { name: "Marcus Lee", email: "marcus.lee@example.com", address: addr("9 Harbor Rd", "Austin", "TX", "78701") },
    items: [{ name: "Mini Amber Jar Candle", sku: "MINI-AMBER", quantity: 1, unit: "12.50" }],
    paidDaysAgo: 10,
    openedDaysAgo: 1,
    dueInDays: 9,
    messages: [{ by: "BUYER", daysAgo: 1, content: "This is way smaller than the photo. Looks like a tea light, not a jar candle." }],
    trackers: [{ carrier: "USPS", tracking_number: "9400111899223344550022", shippedDaysAgo: 9 }],
    reply: { content: "Thanks for getting back to me. A refund is fine, I'll keep the little one as a tea light.", withdraws: false },
  }),
  fixture({
    disputeId: "PP-D-1003",
    captureId: "3MB91234XK003",
    orderId: "5O190127TN003",
    reason: "UNAUTHORISED",
    amount: "240.00",
    buyer: { name: "Dana Whitfield", email: "dana.w@example.com", address: addr("772 Lakeview Dr", "Madison", "WI", "53703") },
    items: [{ name: "Wedding Favor Candles (24 pack)", sku: "FAVOR-24", quantity: 1, unit: "240.00" }],
    paidDaysAgo: 21,
    openedDaysAgo: 3,
    dueInDays: 4,
    messages: [
      { by: "BUYER", daysAgo: 19, content: "Hi! Could the favor candles be lavender instead of vanilla? The wedding is on the 14th. Thanks!" },
      { by: "SELLER", daysAgo: 19, content: "Absolutely, switched to lavender. They'll ship tomorrow." },
      { by: "BUYER", daysAgo: 3, content: "I did not authorize this purchase." },
    ],
    trackers: [{ carrier: "UPS", tracking_number: "1Z999AA10123456784", shippedDaysAgo: 18 }],
    reply: { content: "I just realised my sister used my account to order the wedding favours. I didn't recognise the name on the statement. Withdrawing the claim, sorry for the trouble!", withdraws: true },
  }),
  fixture({
    disputeId: "PP-D-1004",
    captureId: "3MB91234XK004",
    orderId: "5O190127TN004",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amount: "54.00",
    buyer: { name: "Priya Nair", email: "priya.nair@example.com", address: addr("15 Orchard Ln", "Columbus", "OH", "43215") },
    items: [{ name: "Fig & Cassis Candle", sku: "FIG-CASSIS", quantity: 2, unit: "27.00" }],
    paidDaysAgo: 24,
    openedDaysAgo: 4,
    dueInDays: 2,
    messages: [{ by: "BUYER", daysAgo: 4, content: "Ordered 3+ weeks ago and never got a shipping notice or package." }],
    reply: { content: "Thanks for being upfront about it. A refund works for me.", withdraws: false },
  }),
  // Already-resolved history the agent can use to spot product problems.
  fixture({
    disputeId: "PP-D-0901",
    captureId: "3MB91234XK901",
    orderId: "5O190127TN901",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "RESOLVED",
    outcome: "RESOLVED_BUYER_FAVOUR",
    amount: "12.50",
    buyer: { name: "Ellie Grant", email: "ellie.g@example.com", address: addr("3 Pine Ct", "Denver", "CO", "80202") },
    items: [{ name: "Mini Amber Jar Candle", sku: "MINI-AMBER", quantity: 1, unit: "12.50" }],
    paidDaysAgo: 48,
    openedDaysAgo: 40,
    dueInDays: null,
    messages: [{ by: "BUYER", daysAgo: 40, content: "Much smaller than the listing photo suggests." }],
    trackers: [{ carrier: "USPS", tracking_number: "9400111899223344559011", shippedDaysAgo: 47 }],
  }),
  fixture({
    disputeId: "PP-D-0902",
    captureId: "3MB91234XK902",
    orderId: "5O190127TN902",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "RESOLVED",
    outcome: "RESOLVED_BUYER_FAVOUR",
    amount: "25.00",
    buyer: { name: "Tom Reyes", email: "tom.r@example.com", address: addr("88 Bay St", "Tampa", "FL", "33602") },
    items: [{ name: "Mini Amber Jar Candle", sku: "MINI-AMBER", quantity: 2, unit: "12.50" }],
    paidDaysAgo: 33,
    openedDaysAgo: 27,
    dueInDays: null,
    messages: [{ by: "BUYER", daysAgo: 27, content: "Tiny. The photo has no size reference at all." }],
    trackers: [{ carrier: "USPS", tracking_number: "9400111899223344559022", shippedDaysAgo: 32 }],
  }),
];

/** Simulated carrier lookup (a real build would call a carrier API such as EasyPost). */
const CARRIER_EVENTS: Record<string, any> = {
  "9400111899223344550011": {
    carrier: "USPS",
    status: "DELIVERED",
    delivered_at: ago(12),
    delivery_location: "Front porch, Portland OR 97205",
    signature: null,
    photo_on_delivery: true,
  },
  "9400111899223344550022": { carrier: "USPS", status: "DELIVERED", delivered_at: ago(6), delivery_location: "Mailbox, Austin TX 78701" },
  "1Z999AA10123456784": {
    carrier: "UPS",
    status: "DELIVERED",
    delivered_at: ago(15),
    delivery_location: "Front desk, Madison WI 53703",
    signature: "D. WHITFIELD",
  },
};

export function carrierStatus(trackingNumber: string): any {
  return (
    state().carrier[trackingNumber] ?? {
      status: "UNKNOWN",
      note: "No carrier data for this tracking number.",
    }
  );
}

// ---------------------------------------------------------------------------
// Simulated disputes ("Simulate dispute" on the dashboard). They live next to
// the built-in fixtures and are saved to data/simulated.json so a restart keeps
// them. State sits on globalThis so every route bundle sees the same list.

const SIM_FILE = path.join(process.cwd(), "data", "simulated.json");

type SavedSim = { fixtures: Fixture[]; carrier: Record<string, any> };
type MockState = { fixtures: Fixture[]; carrier: Record<string, any>; simIds: Set<string> };

const g = globalThis as typeof globalThis & { __disputeMock?: MockState };

function state(): MockState {
  if (!g.__disputeMock) {
    let saved: SavedSim = { fixtures: [], carrier: {} };
    try {
      saved = JSON.parse(readFileSync(SIM_FILE, "utf8"));
    } catch {}
    g.__disputeMock = {
      fixtures: [...saved.fixtures, ...BUILT_IN],
      carrier: { ...CARRIER_EVENTS, ...saved.carrier },
      simIds: new Set(saved.fixtures.map((f) => f.dispute.dispute_id)),
    };
  }
  return g.__disputeMock;
}

/** Delivers any simulated buyer reply whose time has come. */
function settleReplies() {
  const s = state();
  let changed = false;
  for (const f of s.fixtures) {
    if (!f.replyAt || f.replyAt > Date.now() || !f.reply) continue;
    f.dispute.messages.push({ posted_by: "BUYER", time_posted: new Date(f.replyAt).toISOString(), content: f.reply.content });
    if (f.reply.withdraws) {
      f.dispute.status = "RESOLVED";
      f.dispute.dispute_outcome = { outcome_code: "CANCELED_BY_BUYER" };
    }
    f.replyAt = undefined;
    f.reply = undefined;
    if (s.simIds.has(f.dispute.dispute_id)) changed = true;
  }
  if (changed) saveSimulated();
}

function saveSimulated() {
  const s = state();
  const fixtures = s.fixtures.filter((f) => s.simIds.has(f.dispute.dispute_id));
  const trackingNumbers = new Set(
    fixtures.flatMap((f) => f.order.purchase_units[0].shipping.trackers.map((t: any) => t.tracking_number)),
  );
  const carrier = Object.fromEntries(Object.entries(s.carrier).filter(([n]) => trackingNumbers.has(n)));
  mkdirSync(path.dirname(SIM_FILE), { recursive: true });
  writeFileSync(SIM_FILE, JSON.stringify({ fixtures, carrier } satisfies SavedSim, null, 2));
}

const FIRST_NAMES = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Quinn", "Rowan", "Harper", "Emerson", "Skyler"];
const LAST_NAMES = ["Bennett", "Okafor", "Lindqvist", "Moreno", "Takahashi", "Patel", "O'Brien", "Novak", "Hughes", "Castillo"];
const PLACES = [
  addr("118 Maple Ave", "Seattle", "WA", "98101"),
  addr("27 Spring St", "Boston", "MA", "02108"),
  addr("540 Juniper Way", "Boulder", "CO", "80302"),
  addr("9 Ridge Rd", "Raleigh", "NC", "27601"),
  addr("63 Sunset Blvd", "Phoenix", "AZ", "85004"),
];
const CATALOG = [
  { name: "Cedar & Smoke Candle Trio", sku: "CS-TRIO", unit: "86.00" },
  { name: "Mini Amber Jar Candle", sku: "MINI-AMBER", unit: "12.50" },
  { name: "Fig & Cassis Candle", sku: "FIG-CASSIS", unit: "27.00" },
  { name: "Wedding Favor Candles (24 pack)", sku: "FAVOR-24", unit: "240.00" },
];

/** Demo sales volume per product over the same period, for dispute rates. */
const DEMO_UNITS_SOLD: Record<string, number> = {
  "Cedar & Smoke Candle Trio": 212,
  "Mini Amber Jar Candle": 64,
  "Fig & Cassis Candle": 158,
  "Wedding Favor Candles (24 pack)": 31,
};

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

export const SCENARIOS = [
  { id: "porch", label: "\u201cNever arrived\u201d, but delivered", hint: "Tracking shows a porch drop-off with photo" },
  { id: "friendly-fraud", label: "\u201cUnauthorized\u201d, but buyer chatted", hint: "Buyer messaged about the order, signature on delivery" },
  { id: "gift", label: "Shipped to a different address", hint: "Delivered to a gift recipient, not the payer" },
  { id: "never-shipped", label: "Seller never shipped", hint: "No tracking at all: a refund is right" },
  { id: "tiny", label: "Small \u201cnot as described\u201d", hint: "Repeat complaint about the Mini Amber size" },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

/** Builds a fresh dispute for one of the demo scenarios and adds it to the mock data. */
export function simulateDispute(scenario?: ScenarioId): { disputeId: string; scenario: ScenarioId } {
  const s = state();
  const kind: ScenarioId = scenario ?? pick(SCENARIOS.map((x) => x.id));
  let seq = 2001;
  while (s.fixtures.some((f) => f.dispute.dispute_id === `PP-D-${seq}`)) seq++;
  const disputeId = `PP-D-${seq}`;
  const captureId = `3MB9SIM${digits(6)}`;
  const orderId = `5O19SIM${digits(6)}`;
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const first = name.split(" ")[0];
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
  const home = pick(PLACES);
  const where = (a: any) => `${a.admin_area_2} ${a.admin_area_1} ${a.postal_code}`;
  const base = { disputeId, captureId, orderId, buyer: { name, email, address: home }, openedDaysAgo: 0 };

  let opts: Parameters<typeof fixture>[0];
  let event: any = null;
  let tracking: string | null = null;
  let reply: Reply | undefined;

  switch (kind) {
    case "porch": {
      const item = pick(CATALOG.filter((c) => c.sku !== "MINI-AMBER"));
      const qty = item.sku === "FAVOR-24" ? 1 : 1 + Math.floor(Math.random() * 2);
      tracking = `9400${digits(18)}`;
      opts = {
        ...base,
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        amount: (Number(item.unit) * qty).toFixed(2),
        items: [{ ...item, quantity: qty }],
        paidDaysAgo: 14,
        dueInDays: 10,
        messages: [{ by: "BUYER", daysAgo: 0, content: "My order never showed up. I want my money back." }],
        trackers: [{ carrier: "USPS", tracking_number: tracking, shippedDaysAgo: 13 }],
      };
      event = { carrier: "USPS", status: "DELIVERED", delivered_at: ago(9), delivery_location: `Front porch, ${where(home)}`, signature: null, photo_on_delivery: true };
      reply = { content: "I checked the photo you mentioned. It was behind the planter on my porch! Sorry about that, closing this now.", withdraws: true };
      break;
    }
    case "friendly-fraud": {
      const item = CATALOG.find((c) => c.sku === "FAVOR-24")!;
      tracking = `1Z${digits(16)}`;
      opts = {
        ...base,
        reason: "UNAUTHORISED",
        amount: item.unit,
        items: [{ ...item, quantity: 1 }],
        paidDaysAgo: 20,
        dueInDays: 5,
        messages: [
          { by: "BUYER", daysAgo: 19, content: `Hi, it's ${first}! Can you add a gift note that says "Congrats on the new place"? Thank you!` },
          { by: "SELLER", daysAgo: 19, content: "Of course, the note is added. Shipping tomorrow." },
          { by: "BUYER", daysAgo: 0, content: "I don't recognize this charge." },
        ],
        trackers: [{ carrier: "UPS", tracking_number: tracking, shippedDaysAgo: 18 }],
      };
      event = { carrier: "UPS", status: "DELIVERED", delivered_at: ago(15), delivery_location: `Front desk, ${where(home)}`, signature: name.toUpperCase().replace(/^(\w)\w*/, "$1.") };
      reply = { content: "Oh! That was the housewarming gift I sent. The card statement just showed a different name. My mistake, I'll withdraw it.", withdraws: true };
      break;
    }
    case "gift": {
      const item = CATALOG.find((c) => c.sku === "CS-TRIO")!;
      const other = pick(PLACES.filter((p) => p !== home));
      const recipient = `${pick(FIRST_NAMES.filter((n) => n !== first))} ${name.split(" ")[1]}`;
      tracking = `9400${digits(18)}`;
      opts = {
        ...base,
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        amount: item.unit,
        items: [{ ...item, quantity: 1 }],
        shipTo: { name: recipient, address: other },
        paidDaysAgo: 12,
        dueInDays: 8,
        messages: [{ by: "BUYER", daysAgo: 0, content: "Nothing was ever delivered to me." }],
        trackers: [{ carrier: "USPS", tracking_number: tracking, shippedDaysAgo: 11 }],
      };
      event = { carrier: "USPS", status: "DELIVERED", delivered_at: ago(7), delivery_location: `Mailbox, ${where(other)}`, signature: null };
      reply = { content: `Right, that was the gift for ${recipient.split(" ")[0]}. They got it. Sorry, I'm closing the dispute.`, withdraws: true };
      break;
    }
    case "never-shipped": {
      const item = CATALOG.find((c) => c.sku === "FIG-CASSIS")!;
      opts = {
        ...base,
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        amount: (Number(item.unit) * 2).toFixed(2),
        items: [{ ...item, quantity: 2 }],
        paidDaysAgo: 22,
        dueInDays: 3,
        messages: [{ by: "BUYER", daysAgo: 0, content: "Three weeks and no shipping notice. Where is my order?" }],
      };
      reply = { content: "Okay, thanks for the honesty. Refund please.", withdraws: false };
      break;
    }
    case "tiny": {
      const item = CATALOG.find((c) => c.sku === "MINI-AMBER")!;
      tracking = `9400${digits(18)}`;
      opts = {
        ...base,
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        amount: item.unit,
        items: [{ ...item, quantity: 1 }],
        paidDaysAgo: 9,
        dueInDays: 9,
        messages: [{ by: "BUYER", daysAgo: 0, content: "It's tiny! Nothing like the size in the photo." }],
        trackers: [{ carrier: "USPS", tracking_number: tracking, shippedDaysAgo: 8 }],
      };
      event = { carrier: "USPS", status: "DELIVERED", delivered_at: ago(4), delivery_location: `Mailbox, ${where(home)}` };
      reply = { content: "Thanks. A refund is fine, but please add a size to the photo for other buyers.", withdraws: false };
      break;
    }
  }

  s.fixtures.unshift(fixture({ ...opts, reply }));
  s.simIds.add(disputeId);
  if (tracking && event) s.carrier[tracking] = event;
  saveSimulated();
  return { disputeId, scenario: kind };
}

/** Removes every simulated dispute. Returns the IDs that were removed. */
export function clearSimulated(): string[] {
  const s = state();
  const ids = [...s.simIds];
  s.fixtures = s.fixtures.filter((f) => !s.simIds.has(f.dispute.dispute_id));
  s.simIds.clear();
  saveSimulated();
  return ids;
}

function find(pred: (f: Fixture) => boolean, what: string): Fixture {
  settleReplies();
  const f = state().fixtures.find(pred);
  if (!f) throw new Error(`Mock: ${what} not found`);
  return f;
}

/**
 * The actions PayPal would offer as HATEOAS links in this state. Waiting for
 * the seller: everything. Under review: no new evidence. Closed: nothing.
 */
function withLinks(d: any) {
  const self = { rel: "self", href: `mock://disputes/${d.dispute_id}`, method: "GET" };
  const due = d.seller_response_due_date ? Date.parse(d.seller_response_due_date) : Infinity;
  let rels: string[] = [];
  if (d.status === "WAITING_FOR_SELLER_RESPONSE" && due > Date.now()) rels = ["accept_claim", "provide_evidence", "send_message", "make_offer"];
  else if (d.status === "UNDER_REVIEW") rels = ["accept_claim", "send_message", "provide_supporting_info"];
  else if (d.status !== "RESOLVED") rels = ["accept_claim", "send_message"];
  return { ...d, links: [self, ...rels.map((rel) => ({ rel, href: `mock://disputes/${d.dispute_id}/${rel}`, method: "POST" }))] };
}

/** Demo only: PayPal's ruling on a dispute under review. */
export function resolveDispute(id: string, sellerWins: boolean) {
  const f = find((x) => x.dispute.dispute_id === id, `dispute ${id}`);
  f.dispute.status = "RESOLVED";
  f.dispute.dispute_outcome = { outcome_code: sellerWins ? "RESOLVED_SELLER_FAVOUR" : "RESOLVED_BUYER_FAVOUR" };
  if (state().simIds.has(id)) saveSimulated();
}

export const mockProvider: DisputeProvider = {
  mode: "mock",

  async listDisputes() {
    settleReplies();
    return state().fixtures.map((f) => summarize(f.dispute));
  },
  async getDispute(id) {
    return withLinks(structuredClone(find((f) => f.dispute.dispute_id === id, `dispute ${id}`).dispute));
  },
  async getCapture(captureId) {
    return structuredClone(find((f) => f.capture.id === captureId, `capture ${captureId}`).capture);
  },
  async getOrder(orderId) {
    return structuredClone(find((f) => f.order.id === orderId, `order ${orderId}`).order);
  },
  async searchTransactions(transactionId) {
    return structuredClone(find((f) => f.capture.id === transactionId, `transaction ${transactionId}`).transaction);
  },
  async acceptClaim(id, note) {
    const f = find((x) => x.dispute.dispute_id === id, `dispute ${id}`);
    f.dispute.status = "RESOLVED";
    f.dispute.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR" };
    f.dispute.messages.push({ posted_by: "SELLER", time_posted: new Date().toISOString(), content: note });
    if (state().simIds.has(id)) saveSimulated();
    return { links: [{ rel: "self", href: `mock://disputes/${id}` }] };
  },
  async provideEvidence(id, evidence: EvidenceItem[], notes, files = []) {
    const f = find((x) => x.dispute.dispute_id === id, `dispute ${id}`);
    f.dispute.status = "UNDER_REVIEW";
    f.dispute.evidences = evidence.map((e) => ({
      evidence_type: e.evidence_type,
      notes: e.description,
      source: "SUBMITTED_BY_SELLER",
      documents: files.map((d) => ({ name: d.name })),
    }));
    f.dispute.seller_notes = notes;
    if (state().simIds.has(id)) saveSimulated();
    return { documents: files.map((d) => d.name) };
  },
  async unitsSold() {
    return { ...DEMO_UNITS_SOLD };
  },
  async sendMessage(id, message) {
    const f = find((x) => x.dispute.dispute_id === id, `dispute ${id}`);
    f.dispute.messages.push({ posted_by: "SELLER", time_posted: new Date().toISOString(), content: message });
    // The simulated buyer answers the first message after a short pause.
    if (f.reply && !f.replyAt) f.replyAt = Date.now() + REPLY_DELAY_MS;
    if (state().simIds.has(id)) saveSimulated();
    return { links: [] };
  },
};
