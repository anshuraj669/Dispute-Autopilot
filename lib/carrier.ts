// Carrier tracking for the agent and the evidence packet. Demo mode uses the
// simulated events in lib/mock.ts; with SHIPPO_API_KEY set, sandbox mode asks
// Shippo's tracking API; otherwise it says plainly that it can't check.

import { carrierStatus } from "./mock";

const SHIPPO_CARRIERS: Record<string, string> = { USPS: "usps", UPS: "ups", FEDEX: "fedex", DHL: "dhl_express" };

export type TrackingResult = {
  source: "simulated" | "shippo" | "none";
  carrier: string | null;
  tracking_number: string;
  status: string;
  delivered_at?: string | null;
  delivery_location?: string | null;
  details?: string | null;
  signature?: string | null;
  photo_on_delivery?: boolean;
  history?: { status: string; at: string | null; details: string | null; location: string | null }[];
  note?: string;
};

/** Guesses the carrier from the number's shape when the order doesn't say. */
function guessCarrier(n: string): string | null {
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return "UPS";
  if (/^9[1-5]\d{18,24}$/.test(n)) return "USPS";
  if (/^\d{12}$|^\d{15}$/.test(n)) return "FEDEX";
  if (/^\d{10}$/.test(n)) return "DHL";
  return null;
}

const place = (l: any) => (l ? [l.city, l.state, l.zip].filter(Boolean).join(", ") || null : null);

async function shippo(trackingNumber: string, carrier: string | null, key: string): Promise<TrackingResult> {
  const testKey = key.startsWith("shippo_test_");
  const token = /^SHIPPO_/.test(trackingNumber) ? "shippo" : carrier ? SHIPPO_CARRIERS[carrier.toUpperCase()] : undefined;
  if (!token) {
    return { source: "none", carrier, tracking_number: trackingNumber, status: "UNKNOWN", note: "Unknown carrier, so Shippo can't look this number up." };
  }
  if (testKey && token !== "shippo") {
    return {
      source: "none",
      carrier,
      tracking_number: trackingNumber,
      status: "UNKNOWN",
      note: "Shippo test keys only track SHIPPO_* test numbers; use a live key for real shipments.",
    };
  }
  const res = await fetch(`https://api.goshippo.com/tracks/${token}/${encodeURIComponent(trackingNumber)}`, {
    headers: { Authorization: `ShippoToken ${key}` },
  });
  if (!res.ok) throw new Error(`Shippo tracking -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const t = await res.json();
  const s = t.tracking_status ?? {};
  return {
    source: "shippo",
    carrier: carrier ?? token,
    tracking_number: trackingNumber,
    status: s.status ?? "UNKNOWN",
    delivered_at: s.status === "DELIVERED" ? s.status_date ?? null : null,
    delivery_location: s.status === "DELIVERED" ? place(s.location) : null,
    details: s.status_details ?? null,
    history: (t.tracking_history ?? []).map((h: any) => ({
      status: h.status,
      at: h.status_date ?? null,
      details: h.status_details ?? null,
      location: place(h.location),
    })),
  };
}

export async function trackShipment(trackingNumber: string, carrier: string | null | undefined, mode: "mock" | "sandbox"): Promise<TrackingResult> {
  const c = carrier?.toUpperCase() || guessCarrier(trackingNumber);
  if (mode === "mock") {
    const sim = carrierStatus(trackingNumber);
    return { source: "simulated", tracking_number: trackingNumber, ...sim, carrier: sim.carrier ?? c };
  }
  const key = process.env.SHIPPO_API_KEY;
  if (key) return shippo(trackingNumber, c, key);
  return {
    source: "none",
    carrier: c,
    tracking_number: trackingNumber,
    status: "UNKNOWN",
    note: "No carrier lookup is configured (set SHIPPO_API_KEY). Rely on PayPal's tracker data.",
  };
}
