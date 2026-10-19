// PayPal REST client (sandbox) plus the provider interface the agent and API routes use.
// In PAYPAL_MODE=mock the same interface is served from fixtures (lib/mock.ts).

import type { DisputeSummary, EvidenceItem } from "./types";
import { PRODUCTS } from "./products";
import { listPurchases } from "./purchases";
import { mockProvider } from "./mock";
import { summarize } from "./summarize";
import { SHIPPING_CARRIER } from "./products";

export { summarize };

export interface DisputeProvider {
  mode: "sandbox" | "mock";
  listDisputes(): Promise<DisputeSummary[]>;
  getDispute(id: string): Promise<any>;
  getCapture(captureId: string): Promise<any>;
  getOrder(orderId: string): Promise<any>;
  searchTransactions(transactionId: string, around: string): Promise<any>;
  acceptClaim(id: string, note: string): Promise<any>;
  /** Resolves to the names of the files PayPal accepted alongside the evidence. */
  provideEvidence(id: string, evidence: EvidenceItem[], notes: string, files?: EvidenceFile[]): Promise<{ documents: string[] }>;
  sendMessage(id: string, message: string): Promise<any>;
  /** Units sold per product name, for dispute rates. */
  unitsSold(): Promise<Record<string, number>>;
}

export type EvidenceFile = { name: string; type: string; data: Uint8Array };

const BASE = "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set for sandbox mode");

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export class PayPalError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string,
  ) {
    super(`PayPal ${path} -> ${status}: ${body.slice(0, 500)}`);
  }
}

export async function paypalFetch(path: string, init: RequestInit = {}, retried = false): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await accessToken()}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  // Features switched on in the developer dashboard only reach newly issued
  // tokens, so on a 403 fetch a fresh token and try once more.
  if (res.status === 403 && !retried) {
    cachedToken = null;
    return paypalFetch(path, init, true);
  }
  if (res.status === 403 && path.startsWith("/v1/reporting/")) {
    throw new PayPalError(res.status, `Transaction Search is not enabled for this PayPal app. Turn on "Transaction search" under Apps & Credentials → your app → Features. ${text}`, path);
  }
  if (!res.ok) throw new PayPalError(res.status, text, path);
  return text ? JSON.parse(text) : {};
}

// PayPal carrier codes for the names the agent is likely to write.
const CARRIER_CODES: Record<string, string> = {
  USPS: "USPS",
  UPS: "UPS",
  FEDEX: "FEDEX",
  DHL: "DHL",
  ONTRAC: "ONTRAC",
  CANADAPOST: "CANADA_POST",
  ROYALMAIL: "ROYAL_MAIL",
  AUSTRALIAPOST: "AUSTRALIA_POST",
};

/**
 * PayPal rejects unknown carrier codes (CARRIER_NAME_IS_INVALID). Order trackers
 * don't return the carrier, so a missing one falls back to the store's carrier.
 */
function trackingInfo(trackingNumber: string, carrier: string | undefined) {
  const name = carrier?.trim() || SHIPPING_CARRIER;
  const code = CARRIER_CODES[name.toUpperCase().replace(/[^A-Z]/g, "")];
  return code
    ? { carrier_name: code, tracking_number: trackingNumber }
    : { carrier_name: "OTHER", carrier_name_other: name, tracking_number: trackingNumber };
}

function isoDay(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const sandboxProvider: DisputeProvider = {
  mode: "sandbox",

  async listDisputes() {
    const list = await paypalFetch("/v1/customer/disputes?page_size=50");
    // The list endpoint returns partial objects; fetch details for due dates and transactions.
    const items: any[] = list.items ?? [];
    const details = await Promise.all(items.map((i) => paypalFetch(`/v1/customer/disputes/${i.dispute_id}`)));
    return details.map(summarize);
  },

  getDispute: (id) => paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}`),

  getCapture: (captureId) => paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}`),

  getOrder: (orderId) => paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`),

  async searchTransactions(transactionId, around) {
    // The Transaction Search API needs a window of at most 31 days.
    const center = new Date(around);
    const start = new Date(center.getTime() - 15 * 86_400_000);
    const end = new Date(Math.min(center.getTime() + 15 * 86_400_000, Date.now()));
    const qs = new URLSearchParams({
      transaction_id: transactionId,
      start_date: isoDay(start),
      end_date: isoDay(end),
      fields: "all",
    });
    return paypalFetch(`/v1/reporting/transactions?${qs}`);
  },

  acceptClaim: (id, note) =>
    paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  async provideEvidence(id, evidence, notes, files = []) {
    // PayPal rejects a submission with more than one evidence unless each names the
    // disputed item (ITEM_ID_IS_MANDATORY_FOR_MULTIPLE_EVIDENCES).
    let itemId: string | undefined;
    if (evidence.length > 1) {
      const dispute = await paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}`);
      const disputedItemId = dispute.disputed_transactions?.[0]?.items?.[0]?.item_id;
      // The API only takes alphanumeric item IDs; SKUs like "CS-TRIO" fail with a 500.
      itemId = typeof disputedItemId === "string" && /^[A-Za-z0-9]+$/.test(disputedItemId) ? disputedItemId : undefined;
      if (!itemId) {
        // No usable item to point at: fold everything into the first evidence instead.
        const [first, ...rest] = evidence;
        evidence = [
          {
            ...first,
            description: [first.description, ...rest.map((e) => `${e.evidence_type}: ${e.description}`)].join("\n\n"),
            tracking_number: first.tracking_number ?? rest.find((e) => e.tracking_number)?.tracking_number,
            carrier: first.tracking_number ? first.carrier : rest.find((e) => e.tracking_number)?.carrier,
          },
        ];
      }
    }
    const input = {
      evidences: evidence.map((e) => ({
        evidence_type: e.evidence_type,
        notes: e.description,
        ...(itemId ? { item_id: itemId } : {}),
        ...(e.tracking_number
          ? { evidence_info: { tracking_info: [trackingInfo(e.tracking_number, e.carrier)] } }
          : {}),
      })),
      notes,
    };
    const submit = (withFiles: EvidenceFile[]) => {
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
      for (const f of withFiles) form.append("evidence-file", new Blob([f.data as BlobPart], { type: f.type }), f.name);
      return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { method: "POST", body: form });
    };
    try {
      await submit(files);
      return { documents: files.map((f) => f.name) };
    } catch (err) {
      // The sandbox sometimes fails uploads with a 500. If nothing was recorded,
      // send the evidence without the file rather than not at all.
      if (!(err instanceof PayPalError) || err.status < 500 || !files.length) throw err;
      const dispute = await paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}`);
      if (!dispute.links?.some((l: any) => l.rel === "provide_evidence")) throw err;
      await submit([]);
      return { documents: [] };
    }
  },

  sendMessage: (id, message) =>
    paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  // Demo-store sales recorded at capture time.
  async unitsSold() {
    const sold: Record<string, number> = {};
    for (const p of await listPurchases()) {
      for (const i of p.items) {
        const name = PRODUCTS.find((x) => x.sku === i.sku)?.name ?? i.name;
        sold[name] = (sold[name] ?? 0) + i.quantity;
      }
    }
    return sold;
  },
};

export function provider(): DisputeProvider {
  return process.env.PAYPAL_MODE === "sandbox" ? sandboxProvider : mockProvider;
}

/** Verifies a webhook delivery with PayPal. Returns true only on SUCCESS. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID must be set to receive webhooks");
  const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  // Not from PayPal at all; reject without asking PayPal (which answers 400).
  if (required.some((h) => !headers.get(h))) return false;
  const result = await paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  return result.verification_status === "SUCCESS";
}
