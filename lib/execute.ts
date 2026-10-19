// Carries out an approved decision against PayPal. This is the only code path
// that changes dispute state. It runs on an explicit merchant approval, or on
// its own only when the merchant's autonomy settings allow it (lib/autopilot.ts).
// Before acting it re-checks what PayPal allows right now (lib/guard.ts) and
// that every piece of evidence traces to a source record (lib/integrity.ts).

import { promises as fs } from "fs";
import { assess } from "./assess";
import { uploadPath } from "./collect";
import { COLLECTABLE, type CollectKey } from "./evidence";
import { buildEvidencePacket } from "./packet";
import { provider, type EvidenceFile } from "./paypal";
import { getCase, updateCase } from "./store";
import type { CaseRecord, EvidenceItem } from "./types";

/** `auto` names the rule that allowed the agent to act alone; null means a person approved. */
export async function executeDecision(disputeId: string, auto: string | null = null): Promise<CaseRecord> {
  const record = await getCase(disputeId);
  if (!record?.decision) throw new Error("No agent decision to execute; investigate first.");
  if (record.status === "executed") throw new Error("This decision was already executed.");

  const { decision } = record;
  const paypal = provider();

  // Check PayPal's current lifecycle state and the records before touching anything.
  const a = await assess(disputeId);
  const allowed = a.permissions[decision.action];
  if (!allowed.allowed) throw new Error(`PayPal won't accept this now: ${allowed.why}`);
  if (decision.action === "FIGHT" && a.verification && !a.verification.ok) {
    const blocking = a.verification.problems.filter((p) => p.level === "block").map((p) => p.text);
    throw new Error(`Blocked by the evidence check: ${blocking.join(" ")} Re-investigate to get a corrected decision.`);
  }

  try {
    let detail: string;
    let documents: string[] = [];
    if (decision.action === "ACCEPT") {
      // Accepting the claim refunds the buyer; no separate refund call is needed.
      await paypal.acceptClaim(disputeId, decision.buyer_message);
      detail = "Claim accepted; PayPal refunds the buyer.";
    } else {
      // The PDF packet strengthens the case, but the evidence still goes if it can't be built.
      const files: EvidenceFile[] = [];
      try {
        const packet = await buildEvidencePacket(disputeId);
        files.push({ name: packet.name, type: "application/pdf", data: packet.data });
      } catch (err) {
        console.error(`evidence packet for ${disputeId} failed`, err);
      }
      // What the merchant collected goes too: as evidence entries, with their files.
      const evidence: EvidenceItem[] = [...decision.evidence];
      const cited = new Set(evidence.flatMap((e) => e.sources ?? []));
      for (const c of record.collected ?? []) {
        const spec = COLLECTABLE[c.key as CollectKey];
        if (!spec) continue;
        if (c.file) files.push({ name: c.file.name, type: c.file.type, data: new Uint8Array(await fs.readFile(uploadPath(c.file.path))) });
        // The agent may already have written it into its evidence.
        if (cited.has(`merchant.${c.key}`)) continue;
        evidence.push({ evidence_type: spec.evidenceType, description: `${spec.label}: ${c.note || c.file?.name || "attached"}`, sources: [`merchant.${c.key}`] });
      }
      ({ documents } = await paypal.provideEvidence(disputeId, evidence, decision.seller_statement, files));
      detail = `Submitted ${evidence.length} piece(s) of evidence to PayPal${documents.length ? `, with ${documents.length} file(s): ${documents.join(", ")}` : ""}.`;
    }
    return await updateCase(disputeId, (c) => ({
      ...c,
      status: "executed",
      execution: { action: decision.action, at: new Date().toISOString(), ok: true, detail, auto, documents },
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCase(disputeId, (c) => ({
      ...c,
      execution: { action: decision.action, at: new Date().toISOString(), ok: false, detail: message, auto },
    }));
    throw err;
  }
}
