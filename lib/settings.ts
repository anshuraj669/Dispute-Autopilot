// Merchant settings: the policy the agent reasons with, how much it may do on
// its own, and the assumptions behind the impact numbers. Saved to
// data/settings.json; anything unset falls back to the .env defaults.

import { promises as fs } from "fs";
import path from "path";

export type Autonomy = "suggest" | "auto_small";

export type Settings = {
  merchantName: string;
  refundPolicy: string;
  /** Disputes at or below this amount are cheaper to refund than to fight. */
  autoAcceptThreshold: number;
  /** "suggest": every action waits for approval. "auto_small": act alone under autoLimit. */
  autonomy: Autonomy;
  /** Largest dispute (USD) the agent may act on without approval in auto_small mode. */
  autoLimit: number;
  /** Lowest confidence the agent needs before acting alone. */
  autoMinConfidence: "medium" | "high";
  /** Never fight a "not received" claim without carrier-confirmed delivery. */
  requireDeliveryProof: boolean;
  /** Send the agent's note to the buyer automatically when it acts alone. */
  autoMessageBuyer: boolean;
  disputeFee: number;
  /** Whether the fee is charged only on a lost fight, or on every fight. */
  feeWhen: "lost" | "always";
  manualMinutes: number;
  /** What an hour of the merchant's time is worth (USD). */
  hourlyRate: number;
  /** Minutes to review and approve the agent's evidence packet. */
  reviewMinutes: number;
  /** Share of the price recovered when a "not as described" item comes back. */
  returnRecoveryPct: number;
};

const FILE = path.join(process.cwd(), "data", "settings.json");

export function defaults(): Settings {
  return {
    merchantName: process.env.MERCHANT_NAME ?? "Merchant",
    refundPolicy: process.env.MERCHANT_REFUND_POLICY ?? "Not provided",
    autoAcceptThreshold: Number(process.env.AUTO_ACCEPT_THRESHOLD ?? 15),
    autonomy: "suggest",
    autoLimit: 25,
    autoMinConfidence: "high",
    requireDeliveryProof: true,
    autoMessageBuyer: false,
    disputeFee: Number(process.env.DISPUTE_FEE_USD ?? 15),
    feeWhen: "lost",
    manualMinutes: Number(process.env.MANUAL_MINUTES_PER_DISPUTE ?? 45),
    hourlyRate: 30,
    reviewMinutes: 10,
    returnRecoveryPct: 50,
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    return { ...defaults(), ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch (err: any) {
    if (err?.code === "ENOENT") return defaults();
    throw err;
  }
}

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`expected a number from ${min} to ${max}`);
  return n;
};

/** Validates a partial update, merges it and saves. */
export async function saveSettings(patch: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
  const next = await getSettings();
  const str = (v: unknown, max: number) => {
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`expected text up to ${max} characters`);
    return v.trim();
  };
  if (patch.merchantName !== undefined) next.merchantName = str(patch.merchantName, 120);
  if (patch.refundPolicy !== undefined) next.refundPolicy = str(patch.refundPolicy, 2000);
  if (patch.autoAcceptThreshold !== undefined) next.autoAcceptThreshold = num(patch.autoAcceptThreshold, 0, 10_000);
  if (patch.autonomy !== undefined) {
    if (patch.autonomy !== "suggest" && patch.autonomy !== "auto_small") throw new Error("autonomy must be suggest or auto_small");
    next.autonomy = patch.autonomy;
  }
  if (patch.autoLimit !== undefined) next.autoLimit = num(patch.autoLimit, 0, 10_000);
  if (patch.autoMinConfidence !== undefined) {
    if (patch.autoMinConfidence !== "medium" && patch.autoMinConfidence !== "high") throw new Error("autoMinConfidence must be medium or high");
    next.autoMinConfidence = patch.autoMinConfidence;
  }
  if (patch.requireDeliveryProof !== undefined) next.requireDeliveryProof = Boolean(patch.requireDeliveryProof);
  if (patch.autoMessageBuyer !== undefined) next.autoMessageBuyer = Boolean(patch.autoMessageBuyer);
  if (patch.disputeFee !== undefined) next.disputeFee = num(patch.disputeFee, 0, 1000);
  if (patch.feeWhen !== undefined) {
    if (patch.feeWhen !== "lost" && patch.feeWhen !== "always") throw new Error("feeWhen must be lost or always");
    next.feeWhen = patch.feeWhen;
  }
  if (patch.manualMinutes !== undefined) next.manualMinutes = num(patch.manualMinutes, 1, 600);
  if (patch.hourlyRate !== undefined) next.hourlyRate = num(patch.hourlyRate, 0, 1000);
  if (patch.reviewMinutes !== undefined) next.reviewMinutes = num(patch.reviewMinutes, 0, 600);
  if (patch.returnRecoveryPct !== undefined) next.returnRecoveryPct = num(patch.returnRecoveryPct, 0, 100);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2));
  return next;
}
