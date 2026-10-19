// JSON-file log of demo-store purchases, written when an order is captured.
// Same single-instance trade-offs as lib/store.ts.

import { promises as fs } from "fs";
import path from "path";
import type { Money } from "./types";

const FILE = path.join(process.cwd(), "data", "purchases.json");

export type Purchase = {
  orderId: string;
  captureId: string;
  trackingNumber: string;
  items: { sku: string; name: string; quantity: number; unitAmount: Money }[];
  total: Money;
  buyerEmail: string | null;
  buyerName: string | null;
  purchasedAt: string;
};

let queue: Promise<unknown> = Promise.resolve();

export async function listPurchases(): Promise<Purchase[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

/** Prepends a purchase (newest first), serialized so concurrent captures don't clobber each other. */
export function recordPurchase(p: Purchase): Promise<void> {
  const run = queue.then(async () => {
    const all = await listPurchases();
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify([p, ...all.filter((x) => x.orderId !== p.orderId)], null, 2));
  });
  queue = run.catch(() => undefined);
  return run;
}
