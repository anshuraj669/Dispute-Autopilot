// Tiny JSON-file store for case records (agent decisions, tool traces, executions).
// Good enough for a single-instance demo; swap for a database before real use.

import { promises as fs } from "fs";
import path from "path";
import type { CaseRecord } from "./types";

const FILE = path.join(process.cwd(), "data", "store.json");

let queue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Record<string, CaseRecord>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

export async function getCase(disputeId: string): Promise<CaseRecord | null> {
  return (await readAll())[disputeId] ?? null;
}

export async function allCases(): Promise<Record<string, CaseRecord>> {
  return readAll();
}

/** Serialized read-modify-write so concurrent requests don't clobber each other. */
export function updateCase(disputeId: string, fn: (current: CaseRecord) => CaseRecord): Promise<CaseRecord> {
  const run = queue.then(async () => {
    const all = await readAll();
    const current: CaseRecord = all[disputeId] ?? {
      disputeId,
      status: "investigating",
      decision: null,
      toolCalls: [],
      investigatedAt: null,
      error: null,
      execution: null,
    };
    const next = fn(current);
    all[disputeId] = next;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(all, null, 2));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Drops case records (used when clearing simulated demo disputes). */
export function deleteCases(disputeIds: string[]): Promise<void> {
  const run = queue.then(async () => {
    const all = await readAll();
    for (const id of disputeIds) delete all[id];
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(all, null, 2));
  });
  queue = run.catch(() => undefined);
  return run;
}
