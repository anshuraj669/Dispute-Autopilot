import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findContradictions, verifyDecision } from "@/lib/integrity";
import { ago, caseFile, decision } from "./helpers/factory";

const titles = (cf: ReturnType<typeof caseFile>) => findContradictions(cf).map((c) => c.title);
const RULES = { requireDeliveryProof: true };

describe("findContradictions", () => {
  test("'not received' with a carrier delivery is flagged in the seller's favour", () => {
    const c = findContradictions(caseFile()).find((x) => x.title === "Claim vs carrier");
    assert.ok(c);
    assert.equal(c.helps, "seller");
    assert.equal(c.severity, "high");
  });

  test("delivery to a different ZIP helps the buyer", () => {
    const cf = caseFile();
    cf.tracking[0].delivery_location = "Mailbox, Austin TX 78701";
    const c = findContradictions(cf).find((x) => x.title === "Delivered to a different ZIP");
    assert.equal(c?.helps, "buyer");
  });

  test("a signature matching neither payer nor recipient is flagged", () => {
    const cf = caseFile();
    cf.tracking[0].signature = "J. STRANGER";
    assert.ok(titles(cf).includes("Signature doesn't match"));
    cf.tracking[0].signature = "S. CARTER";
    assert.ok(!titles(cf).includes("Signature doesn't match"));
  });

  test("delivery before the shipment was created is flagged", () => {
    const cf = caseFile();
    cf.tracking[0].delivered_at = ago(20);
    assert.ok(titles(cf).includes("Timeline doesn't add up"));
  });

  test("a tracking number the carrier doesn't know is flagged", () => {
    const cf = caseFile();
    cf.tracking[0] = { ...cf.tracking[0], status: "UNKNOWN", delivered_at: null, delivery_location: null };
    assert.ok(titles(cf).includes("Carrier has no record"));
  });

  test("'unauthorized' after the buyer wrote about the order helps the seller", () => {
    const cf = caseFile({
      reason: "UNAUTHORISED",
      messages: [{ by: "BUYER", at: ago(19), content: "Lavender please", fact: "message.1" }],
    });
    const c = findContradictions(cf).find((x) => x.title === "Claim vs earlier messages");
    assert.equal(c?.helps, "seller");
    assert.ok(c?.facts.includes("message.1"));
  });

  test("a partial dispute is noted", () => {
    assert.ok(titles(caseFile({ amount: 40, captureAmount: 86 })).includes("Partial dispute"));
  });

  test("a clean case with no claim conflict has no contradictions", () => {
    const cf = caseFile({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" });
    assert.deepEqual(findContradictions(cf), []);
  });
});

describe("verifyDecision", () => {
  test("a fully sourced fight passes", () => {
    const v = verifyDecision(decision(), caseFile(), RULES);
    assert.equal(v.ok, true, JSON.stringify(v.problems));
    assert.deepEqual(v.items[0].cited, ["carrier.1.status", "order.ship_to"]);
  });

  test("a fight with no evidence is blocked", () => {
    assert.equal(verifyDecision(decision({ evidence: [] }), caseFile(), RULES).ok, false);
  });

  test("evidence citing no facts or invented facts is blocked", () => {
    const uncited = decision({ evidence: [{ evidence_type: "OTHER", description: "trust me", sources: [] }] });
    assert.equal(verifyDecision(uncited, caseFile(), RULES).ok, false);
    const invented = decision({ evidence: [{ evidence_type: "OTHER", description: "x", sources: ["order.ship_to", "carrier.9.status"] }] });
    const v = verifyDecision(invented, caseFile(), RULES);
    assert.equal(v.ok, false);
    assert.deepEqual(v.items[0].missing, ["carrier.9.status"]);
  });

  test("a tracking number that isn't on the order is blocked, in evidence or statement", () => {
    const d1 = decision();
    d1.evidence[0].tracking_number = "1Z999AA10123456784";
    assert.equal(verifyDecision(d1, caseFile(), RULES).ok, false);
    const d2 = decision({ seller_statement: "Delivered under 1Z999AA10123456784." });
    assert.equal(verifyDecision(d2, caseFile(), RULES).ok, false);
  });

  test("tracking numbers are compared case-insensitively", () => {
    const cf = caseFile({ trackers: [{ number: "1Z999AA10123456784", carrier: "UPS", shippedAt: null, fact: "tracker.1" }] });
    const d = decision({ seller_statement: "See 1z999aa10123456784.", evidence: [{ evidence_type: "OTHER", description: "x", tracking_number: "1z999aa10123456784", sources: ["tracker.1"] }] });
    assert.equal(verifyDecision(d, cf, { requireDeliveryProof: false }).ok, true);
  });

  test("an amount that matches nothing is a warning, not a block", () => {
    const v = verifyDecision(decision({ seller_statement: "The buyer paid $99.99." }), caseFile(), RULES);
    assert.equal(v.ok, true);
    assert.ok(v.problems.some((p) => p.level === "warn" && p.text.includes("$99.99")));
  });

  test("item unit and line totals are accepted amounts", () => {
    const cf = caseFile({ amount: 54, captureAmount: 54, items: [{ name: "Fig", sku: null, quantity: 2, unit: 27 }] });
    const v = verifyDecision(decision({ seller_statement: "Two candles at $27.00, $54.00 total." }), cf, { requireDeliveryProof: false });
    assert.ok(!v.problems.some((p) => p.level === "warn"));
  });

  test("the delivery-proof rule blocks a 'not received' fight without delivery to the address", () => {
    const cf = caseFile({ trackers: [], tracking: [] });
    const d = decision({ seller_statement: "We shipped it.", evidence: [{ evidence_type: "OTHER", description: "x", sources: ["order.ship_to"] }] });
    assert.equal(verifyDecision(d, cf, RULES).ok, false);
    assert.equal(verifyDecision(d, cf, { requireDeliveryProof: false }).ok, true);
  });

  test("refunds are never blocked", () => {
    const v = verifyDecision(decision({ action: "ACCEPT", evidence: [], seller_statement: "" }), caseFile({ trackers: [], tracking: [] }), RULES);
    assert.equal(v.ok, true);
    assert.deepEqual(v.problems, []);
  });
});
