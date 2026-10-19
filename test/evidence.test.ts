import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildChecklist } from "@/lib/evidence";
import { PRIOR, score } from "@/lib/score";
import { ago, assumptionsFixture, caseFile } from "./helpers/factory";

const checklist = (cf: ReturnType<typeof caseFile>) => buildChecklist(cf, score(cf, PRIOR, "test"), PRIOR, assumptionsFixture());
const item = (cf: ReturnType<typeof caseFile>, key: string) => checklist(cf).items.find((i) => i.key === key);

describe("buildChecklist", () => {
  test("'not received' lists tracking, delivery, signature, proof items and protection", () => {
    const keys = checklist(caseFile()).items.map((i) => i.key);
    assert.deepEqual(keys, ["tracking", "delivered", "signature", "delivery_photo", "carrier_pod", "protection"]);
  });

  test("proven facts show as 'have' with the facts behind them", () => {
    const delivered = item(caseFile(), "delivered");
    assert.equal(delivered?.status, "have");
    assert.deepEqual(delivered?.facts, ["carrier.1.status", "order.ship_to"]);
  });

  test("missing collectable evidence is priced and says how to get it", () => {
    const pod = item(caseFile(), "carrier_pod");
    assert.equal(pod?.status, "missing");
    assert.equal(pod?.collect, "carrier_pod");
    assert.ok(pod?.how);
    assert.ok(pod!.gainPts! > 0);
    assert.ok(pod!.gainUsd! >= 0);
  });

  test("evidence the merchant added shows as 'collected'", () => {
    const cf = caseFile({ collected: [{ key: "carrier_pod", note: "POD letter", at: ago(0) }] });
    assert.equal(item(cf, "carrier_pod")?.status, "collected");
  });

  test("without tracking there is nothing to prove delivery of", () => {
    const cf = caseFile({ trackers: [], tracking: [] });
    assert.equal(item(cf, "tracking")?.status, "not_collectable");
    assert.equal(item(cf, "delivery_photo"), undefined);
  });

  test("'unauthorized' asks for outside contact, repeat orders and device match", () => {
    const keys = checklist(caseFile({ reason: "UNAUTHORISED" })).items.map((i) => i.key);
    for (const k of ["outside_contact", "repeat_customer", "device_match"]) assert.ok(keys.includes(k), k);
  });

  test("'not as described' asks for listing, photos and the refund policy", () => {
    const cf = caseFile({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", refundPolicy: "30 days" });
    const items = checklist(cf).items;
    assert.deepEqual(items.map((i) => i.key), ["listing_snapshot", "item_photos", "policy"]);
    assert.equal(items[2].status, "have");
  });

  test("collect-by is one day before PayPal's deadline", () => {
    const cf = caseFile({ dueAt: "2026-11-10T12:00:00.000Z" });
    assert.equal(checklist(cf).collectBy, "2026-11-09T12:00:00.000Z");
    assert.equal(checklist(caseFile({ dueAt: null })).collectBy, null);
  });
});
