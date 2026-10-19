// Evidence the merchant collects by hand after the agent points out a gap.
// Files are kept under data/uploads, fingerprinted, and later attached to the
// PayPal submission and listed in the evidence packet.

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { COLLECTABLE, type CollectKey } from "./evidence";
import { getCase, updateCase } from "./store";
import type { CollectedEvidence } from "./types";

const DIR = path.join(process.cwd(), "data", "uploads");

/** Stored paths are relative to data/uploads, so no server path reaches the browser. */
export const uploadPath = (stored: string) => path.join(DIR, path.normalize(stored).replace(/^(\.\.[/\\])+/, ""));
// What PayPal accepts as dispute evidence files.
const TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function addCollected(disputeId: string, key: string, note: string, file: File | null): Promise<CollectedEvidence> {
  if (!(key in COLLECTABLE)) throw new Error("Unknown evidence type.");
  const text = note.trim();
  if (!text && !file) throw new Error("Add a note or a file.");
  if (text.length > 1000) throw new Error("Keep the note under 1000 characters.");
  if (!(await getCase(disputeId))) throw new Error("Investigate the dispute first.");

  let saved: CollectedEvidence["file"];
  if (file) {
    if (!TYPES.has(file.type)) throw new Error("PayPal accepts PDF, PNG, JPEG or GIF files.");
    if (file.size > MAX_BYTES) throw new Error("Files must be 5 MB or smaller.");
    const data = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(data).digest("hex");
    const ext = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" }[file.type];
    const stored = path.join(disputeId.replace(/[^A-Za-z0-9-]/g, "_"), `${key}-${sha256.slice(0, 12)}.${ext}`);
    await fs.mkdir(path.dirname(uploadPath(stored)), { recursive: true });
    await fs.writeFile(uploadPath(stored), data);
    const name = `${key}.${ext}`;
    saved = { name, type: file.type, size: file.size, sha256, path: stored };
  }

  const item: CollectedEvidence = { key, note: text, at: new Date().toISOString(), ...(saved ? { file: saved } : {}) };
  await updateCase(disputeId, (c) => ({ ...c, collected: [...(c.collected ?? []).filter((x) => x.key !== key), item] }));
  return item;
}

export async function removeCollected(disputeId: string, key: string) {
  if (!(key in COLLECTABLE)) throw new Error("Unknown evidence type.");
  const record = await getCase(disputeId);
  const item = record?.collected?.find((x) => x.key === (key as CollectKey));
  if (item?.file) await fs.rm(uploadPath(item.file.path), { force: true });
  await updateCase(disputeId, (c) => ({ ...c, collected: (c.collected ?? []).filter((x) => x.key !== key) }));
}
