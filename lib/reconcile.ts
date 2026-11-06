// Webhooks get lost: a tunnel restarts, the server is down when PayPal calls,
// or a delivery arrives late. So the dispute list is the source of truth, and
// each time it's fetched, open disputes that arrived while the app was watching
// but never got a case record are handed to the agent. Disputes from before the
// app started watching are left for the merchant to start.

import { promises as fs } from "fs";
import path from "path";
import type { CaseRecord, DisputeSummary } from "./types";

const FILE = path.join(process.cwd(), "data", "intake.json");

/** Open disputes created at or after `since` that have no case record. */
export function missedDisputes(
  disputes: Pick<DisputeSummary, "id" | "status" | "createdAt">[],
  cases: Record<string, CaseRecord>,
  since: number,
): string[] {
  return disputes
    .filter((d) => d.status !== "RESOLVED" && !cases[d.id] && Date.parse(d.createdAt) >= since)
    .map((d) => d.id);
}

/** When the app started watching for new disputes, recorded on first use. */
export async function watchingSince(now = Date.now()): Promise<number> {
  try {
    const saved = JSON.parse(await fs.readFile(FILE, "utf8")).watchingSince;
    if (typeof saved === "number") return saved;
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ watchingSince: now }, null, 2));
  return now;
}
