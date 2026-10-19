// End-to-end checks of the decision engine in demo mode (PAYPAL_MODE=mock):
// case files built from the sample disputes, the calibrated odds, contradictions,
// simulated disputes, and execution against the mock PayPal API. No Claude calls.

import "./helpers/sandbox";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { assess } from "@/lib/assess";
import { addCollected, removeCollected } from "@/lib/collect";
import { executeDecision } from "@/lib/execute";
import { clearSimulated, resolveDispute, simulateDispute } from "@/lib/mock";
import { provider } from "@/lib/paypal";
import { getCase, updateCase } from "@/lib/store";
import type { Decision } from "@/lib/types";
import { decision } from "./helpers/factory";

const paypal = provider();

/** Stores an agent decision the way lib/agent.ts would, without calling Claude. */
const decide = (id: string, d: Decision) =>
  updateCase(id, (c) => ({ ...c, status: "awaiting_approval", decision: d, investigatedAt: new Date().toISOString() }));

describe("mock provider", () => {
  test("runs in mock mode and lists the sample disputes", async () => {
    assert.equal(paypal.mode, "mock");
    const ids = (await paypal.listDisputes()).map((d) => d.id);
    for (const id of ["PP-D-1001", "PP-D-1002", "PP-D-1003", "PP-D-1004", "PP-D-0901", "PP-D-0902"]) assert.ok(ids.includes(id), id);
  });

  test("an open dispute offers evidence, refund and messaging links", async () => {
    const d = await paypal.getDispute("PP-D-1001");
    const rels = d.links.map((l: any) => l.rel);
    for (const r of ["provide_evidence", "accept_claim", "send_message"]) assert.ok(rels.includes(r), r);
  });

  test("unknown disputes throw", async () => {
    await assert.rejects(paypal.getDispute("NOPE"), /not found/);
  });
});

describe("sample disputes", () => {
  test("PP-D-1001: delivered 'not received' scores well with a sourced case file", async () => {
    const a = await assess("PP-D-1001");
    assert.equal(a.score.group, "NR");
    assert.ok(a.score.p > 0.6, `p=${a.score.p}`);
    assert.ok(a.score.factors.some((f) => f.key === "delivered_to_address"));
    assert.ok(a.score.factors.some((f) => f.key === "delivery_photo"));
    assert.ok(a.contradictions.some((c) => c.title === "Claim vs carrier"));
    assert.ok(a.ev.fightEdge > 0);
    assert.ok(a.caseFile.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256)));
    const sourceIds = new Set(a.caseFile.sources.map((s) => s.id));
    assert.ok(a.caseFile.facts.every((f) => sourceIds.has(f.source)), "every fact points at a source");
    assert.ok(a.permissions.FIGHT.allowed);
  });

  test("PP-D-1002: small 'not as described' with repeat complaints is not worth fighting", async () => {
    const a = await assess("PP-D-1002");
    assert.equal(a.score.group, "SNAD");
    assert.equal(a.caseFile.sameComplaints, 2);
    assert.ok(a.score.factors.some((f) => f.key === "repeat_complaints"));
    assert.ok(a.ev.fightEdge < 0);
  });

  test("PP-D-1003: 'unauthorized' after the buyer chatted is flagged", async () => {
    const a = await assess("PP-D-1003");
    assert.equal(a.score.group, "UA");
    assert.ok(a.score.factors.some((f) => f.key === "prior_contact"));
    assert.ok(a.contradictions.some((c) => c.title === "Claim vs earlier messages"));
  });

  test("PP-D-1004: never shipped has no tracking and low odds", async () => {
    const a = await assess("PP-D-1004");
    assert.equal(a.caseFile.trackers.length, 0);
    assert.ok(a.score.factors.some((f) => f.key === "no_tracking"));
    assert.ok(a.score.p < 0.2, `p=${a.score.p}`);
    assert.equal(a.checklist.items.find((i) => i.key === "tracking")?.status, "not_collectable");
  });

  test("demo mode learns from the synthetic history", async () => {
    const a = await assess("PP-D-1001");
    assert.ok(a.model.n >= 400);
  });
});

describe("collected evidence", () => {
  test("adding evidence raises the odds and marks the decision stale; removing it undoes that", async () => {
    await decide("PP-D-1001", decision());
    const before = await assess("PP-D-1001");
    await addCollected("PP-D-1001", "carrier_pod", "USPS proof of delivery letter", null);
    const after = await assess("PP-D-1001");
    assert.ok(after.score.p > before.score.p);
    assert.equal(after.checklist.items.find((i) => i.key === "carrier_pod")?.status, "collected");
    assert.ok(after.caseFile.facts.some((f) => f.id === "merchant.carrier_pod"));
    assert.match(after.stale ?? "", /You added evidence/);

    await removeCollected("PP-D-1001", "carrier_pod");
    assert.equal((await assess("PP-D-1001")).score.p, before.score.p);
  });

  test("validates the key, the note and the file type", async () => {
    await assert.rejects(addCollected("PP-D-1001", "bogus", "x", null), /Unknown evidence type/);
    await assert.rejects(addCollected("PP-D-1001", "carrier_pod", "  ", null), /Add a note or a file/);
    await assert.rejects(addCollected("PP-D-1002", "item_photos", "x", null), /Investigate the dispute first/);
    const exe = new File([new Uint8Array([1, 2, 3])], "x.exe", { type: "application/x-msdownload" });
    await assert.rejects(addCollected("PP-D-1001", "carrier_pod", "x", exe), /PDF, PNG, JPEG or GIF/);
  });

  test("stores an uploaded file with its fingerprint", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
    const item = await addCollected("PP-D-1001", "delivery_photo", "", png);
    assert.equal(item.file?.type, "image/png");
    assert.match(item.file?.sha256 ?? "", /^[0-9a-f]{64}$/);
    assert.ok(existsSync(`data/uploads/${item.file!.path}`));
    await removeCollected("PP-D-1001", "delivery_photo");
    assert.ok(!existsSync(`data/uploads/${item.file!.path}`));
  });
});

describe("executeDecision", () => {
  test("refuses to run without a decision", async () => {
    await assert.rejects(executeDecision("PP-D-1002"), /investigate first/);
  });

  test("blocks a fight whose evidence fails the integrity check", async () => {
    await decide("PP-D-1003", decision({ evidence: [{ evidence_type: "OTHER", description: "trust me", sources: [] }], seller_statement: "Trust me." }));
    await assert.rejects(executeDecision("PP-D-1003"), /Blocked by the evidence check/);
    assert.equal((await paypal.getDispute("PP-D-1003")).status, "WAITING_FOR_SELLER_RESPONSE");
  });

  test("submits a sourced fight, moves the dispute to review and won't run twice", async () => {
    await decide("PP-D-1001", decision({ seller_statement: "USPS 9400111899223344550011 shows delivery of the $86.00 order." }));
    const rec = await executeDecision("PP-D-1001");
    assert.equal(rec.status, "executed");
    assert.equal(rec.execution?.ok, true);
    assert.equal(rec.execution?.auto, null);
    const d = await paypal.getDispute("PP-D-1001");
    assert.equal(d.status, "UNDER_REVIEW");
    assert.ok(!d.links.some((l: any) => l.rel === "provide_evidence"), "no more evidence once under review");
    await assert.rejects(executeDecision("PP-D-1001"), /already executed/);
  });

  test("accepting a claim refunds and closes the dispute", async () => {
    await decide("PP-D-1004", decision({ action: "ACCEPT", evidence: [], seller_statement: "", buyer_message: "Sorry, refunding now." }));
    const rec = await executeDecision("PP-D-1004");
    assert.equal(rec.execution?.action, "ACCEPT");
    const d = await paypal.getDispute("PP-D-1004");
    assert.equal(d.status, "RESOLVED");
    assert.equal(d.dispute_outcome.outcome_code, "RESOLVED_BUYER_FAVOUR");
    assert.equal((await getCase("PP-D-1004"))?.status, "executed");
  });
});

describe("simulated disputes", () => {
  test("each scenario produces the case it describes", async () => {
    const porch = await assess(simulateDispute("porch").disputeId);
    assert.ok(porch.score.factors.some((f) => f.key === "delivered_to_address"));
    assert.ok(porch.score.factors.some((f) => f.key === "delivery_photo"));

    const fraud = await assess(simulateDispute("friendly-fraud").disputeId);
    assert.equal(fraud.score.group, "UA");
    assert.ok(fraud.contradictions.some((c) => c.title === "Claim vs earlier messages"));

    const gift = await assess(simulateDispute("gift").disputeId);
    // Delivered to the gift recipient, who is the order's ship-to, not the payer.
    assert.ok(gift.score.factors.some((f) => f.key === "delivered_to_address"));
    assert.ok(!gift.contradictions.some((c) => c.title === "Delivered to a different ZIP"));
    assert.ok(gift.contradictions.some((c) => c.title === "Shipped to someone other than the payer"));

    const never = await assess(simulateDispute("never-shipped").disputeId);
    assert.equal(never.caseFile.trackers.length, 0);

    const tiny = await assess(simulateDispute("tiny").disputeId);
    assert.equal(tiny.score.group, "SNAD");
    assert.ok(tiny.caseFile.sameComplaints >= 2);
    assert.ok(tiny.ev.fightEdge < 0);
  });

  test("simulated disputes are saved and can be cleared", async () => {
    const { disputeId } = simulateDispute();
    assert.ok(existsSync("data/simulated.json"));
    const removed = clearSimulated();
    assert.ok(removed.includes(disputeId));
    assert.ok(!(await paypal.listDisputes()).some((d) => d.id === disputeId));
  });

  test("PayPal's ruling resolves a dispute under review", async () => {
    const { disputeId } = simulateDispute("porch");
    await paypal.provideEvidence(disputeId, [], "notes");
    resolveDispute(disputeId, true);
    const d = await paypal.getDispute(disputeId);
    assert.equal(d.status, "RESOLVED");
    assert.equal(d.dispute_outcome.outcome_code, "RESOLVED_SELLER_FAVOUR");
    clearSimulated();
  });
});
