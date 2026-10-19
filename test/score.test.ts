import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectFeatures, featuresFor, groupOf, PRIOR, score, scoreFeatures, scoreWith } from "@/lib/score";
import { ago, caseFile } from "./helpers/factory";

describe("groupOf", () => {
  test("maps PayPal reasons to scoring groups", () => {
    assert.equal(groupOf("MERCHANDISE_OR_SERVICE_NOT_RECEIVED"), "NR");
    assert.equal(groupOf("UNAUTHORISED"), "UA");
    assert.equal(groupOf("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"), "SNAD");
    assert.equal(groupOf("DUPLICATE_TRANSACTION"), "OTHER");
  });
});

describe("featuresFor", () => {
  test("lists only features weighted in the group, never the base", () => {
    const nr = featuresFor("NR");
    assert.ok(nr.includes("delivered_to_address"));
    assert.ok(!nr.includes("prior_contact"));
    assert.ok(!nr.includes("base" as never));
    assert.deepEqual(featuresFor("OTHER"), []);
  });
});

describe("scoreFeatures", () => {
  test("with no features it is the sigmoid of the base weight", () => {
    assert.ok(Math.abs(scoreFeatures("NR", [], PRIOR) - 1 / (1 + Math.exp(1.5))) < 1e-12);
  });

  test("positive weights raise and negative weights lower the estimate", () => {
    const base = scoreFeatures("NR", [], PRIOR);
    assert.ok(scoreFeatures("NR", ["delivered_to_address"], PRIOR) > base);
    assert.ok(scoreFeatures("NR", ["no_tracking"], PRIOR) < base);
  });

  test("ignores features with no weight in the group", () => {
    assert.equal(scoreFeatures("NR", ["prior_contact"], PRIOR), scoreFeatures("NR", [], PRIOR));
  });
});

describe("detectFeatures", () => {
  test("delivery to the ship-to ZIP counts as delivered_to_address", () => {
    const f = detectFeatures(caseFile());
    assert.deepEqual(f.get("delivered_to_address"), ["carrier.1.status", "order.ship_to"]);
    assert.ok(!f.has("delivered_elsewhere"));
    assert.ok(!f.has("no_tracking"));
  });

  test("delivery to another ZIP counts as delivered_elsewhere", () => {
    const cf = caseFile();
    cf.tracking[0].delivery_location = "Mailbox, Austin TX 78701";
    const f = detectFeatures(cf);
    assert.ok(f.has("delivered_elsewhere"));
    assert.ok(!f.has("delivered_to_address"));
  });

  test("an order with no trackers is no_tracking", () => {
    assert.ok(detectFeatures(caseFile({ trackers: [], tracking: [] })).has("no_tracking"));
  });

  test("signature and delivery photo come from the carrier scan", () => {
    const cf = caseFile();
    cf.tracking[0].signature = "S. CARTER";
    cf.tracking[0].photo_on_delivery = true;
    const f = detectFeatures(cf);
    assert.deepEqual(f.get("signature"), ["carrier.1.signature"]);
    assert.deepEqual(f.get("delivery_photo"), ["carrier.1.photo"]);
  });

  test("$750 or more without a signature is flagged", () => {
    assert.ok(detectFeatures(caseFile({ amount: 800 })).has("high_value_no_signature"));
    assert.ok(!detectFeatures(caseFile({ amount: 749 })).has("high_value_no_signature"));
  });

  test("buyer messages more than an hour before the dispute count as prior contact", () => {
    const early = { by: "BUYER" as const, at: ago(19), content: "Lavender please", fact: "message.1" };
    const claim = { by: "BUYER" as const, at: ago(2), content: "Not authorized", fact: "message.2" };
    const f = detectFeatures(caseFile({ reason: "UNAUTHORISED", messages: [early, claim] }));
    assert.deepEqual(f.get("prior_contact"), ["message.1"]);
    assert.ok(!detectFeatures(caseFile({ messages: [claim] })).has("prior_contact"));
  });

  test("a different payer surname or ZIP means shipped to someone else", () => {
    const cf = caseFile({ shipTo: { name: "Jo Novak", zip: "10001", line1: null, address: null } });
    assert.ok(detectFeatures(cf).has("ship_to_other"));
    assert.ok(!detectFeatures(caseFile()).has("ship_to_other"));
  });

  test("evidence the merchant collected turns on its feature", () => {
    const f = detectFeatures(caseFile({ collected: [{ key: "carrier_pod", note: "POD letter", at: ago(0) }] }));
    assert.deepEqual(f.get("carrier_pod"), ["merchant.carrier_pod"]);
  });

  test("earlier same-product complaints are repeat_complaints", () => {
    assert.ok(detectFeatures(caseFile({ sameComplaints: 2 })).has("repeat_complaints"));
  });
});

describe("score", () => {
  test("only features that apply to the claim's group are active", () => {
    const cf = caseFile({ sameComplaints: 3 }); // repeat_complaints is a SNAD feature
    const s = score(cf, PRIOR, "test");
    assert.equal(s.group, "NR");
    assert.ok(s.active.includes("NR.delivered_to_address"));
    assert.ok(!s.active.some((k) => k.endsWith("repeat_complaints")));
  });

  test("p matches scoreFeatures over the active features", () => {
    const s = score(caseFile(), PRIOR, "test");
    assert.equal(s.p, scoreFeatures("NR", ["delivered_to_address"], PRIOR));
    assert.equal(s.baseP, scoreFeatures("NR", [], PRIOR));
    assert.equal(s.model, "test");
  });

  test("each factor's points are the change from removing it, largest first", () => {
    const cf = caseFile({ protection: "ELIGIBLE" });
    const s = score(cf, PRIOR, "test");
    assert.equal(s.factors.length, 2);
    assert.equal(s.factors[0].key, "delivered_to_address");
    const without = scoreFeatures("NR", ["protection_eligible"], PRIOR);
    assert.ok(Math.abs(s.factors[0].points - (s.p - without) * 100) < 1e-9);
    assert.ok(Math.abs(s.factors[0].points) >= Math.abs(s.factors[1].points));
  });
});

describe("scoreWith", () => {
  test("adding a missing feature changes the estimate", () => {
    const s = score(caseFile(), PRIOR, "test");
    assert.ok(scoreWith(s, "carrier_pod", PRIOR) > s.p);
  });

  test("adding a feature that is already active changes nothing", () => {
    const s = score(caseFile(), PRIOR, "test");
    assert.equal(scoreWith(s, "delivered_to_address", PRIOR), s.p);
  });
});
