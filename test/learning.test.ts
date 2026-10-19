import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEMO_TRUTH, fit, realExamples, type Example } from "@/lib/learning";
import { PRIOR } from "@/lib/score";
import type { CaseRecord } from "@/lib/types";
import { ago, record, summary } from "./helpers/factory";

const prediction = { p: 0.8, group: "NR", features: ["NR.delivered_to_address"], model: "test", agentEstimate: 0.7, at: ago(5) };
const fought = (over: Partial<CaseRecord> = {}) =>
  record({ status: "executed", prediction, execution: { action: "FIGHT", at: ago(3), ok: true, detail: "" }, ...over });

describe("realExamples", () => {
  test("a fought dispute with a ruling becomes an example", () => {
    const ex = realExamples([summary({ outcome: "RESOLVED_SELLER_FAVOUR" })], { "T-1": fought() });
    assert.equal(ex.length, 1);
    assert.equal(ex[0].won, 1);
    assert.equal(ex[0].predicted, 0.8);
    assert.equal(ex[0].source, "real");
  });

  test("a buyer withdrawal counts as a win, a buyer ruling as a loss", () => {
    assert.equal(realExamples([summary({ outcome: "CANCELED_BY_BUYER" })], { "T-1": fought() })[0].won, 1);
    assert.equal(realExamples([summary({ outcome: "RESOLVED_BUYER_FAVOUR" })], { "T-1": fought() })[0].won, 0);
  });

  test("refunds, open disputes, failed submissions and unfrozen predictions are skipped", () => {
    const d = summary({ outcome: "RESOLVED_BUYER_FAVOUR" });
    assert.equal(realExamples([d], { "T-1": fought({ execution: { action: "ACCEPT", at: ago(1), ok: true, detail: "" } }) }).length, 0);
    assert.equal(realExamples([summary({ outcome: null })], { "T-1": fought() }).length, 0);
    assert.equal(realExamples([d], { "T-1": fought({ execution: { action: "FIGHT", at: ago(1), ok: false, detail: "" } }) }).length, 0);
    assert.equal(realExamples([d], { "T-1": fought({ prediction: null }) }).length, 0);
    assert.equal(realExamples([d], {}).length, 0);
  });
});

describe("fit", () => {
  const examples = (n: number, features: string[], wins: number): Example[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `E${i}`, at: ago(n - i), group: "NR", features, won: i < wins ? 1 : 0, source: "demo", agentEstimate: null, predicted: null,
    }));

  test("with no data the weights stay at the prior", () => {
    const w = fit([]);
    for (const k of Object.keys(PRIOR)) assert.ok(Math.abs(w[k] - PRIOR[k]) < 1e-9, k);
  });

  test("moves a weight toward what the outcomes show", () => {
    // Delivery photo cases almost always won: its weight should rise.
    const w = fit(examples(200, ["NR.delivery_photo"], 190));
    assert.ok(w["NR.delivery_photo"] > PRIOR["NR.delivery_photo"]);
  });

  test("a stronger prior keeps weights closer to the start", () => {
    const data = examples(100, ["NR.delivery_photo"], 95);
    const loose = fit(data, PRIOR, 0.5);
    const tight = fit(data, PRIOR, 50);
    assert.ok(Math.abs(tight["NR.delivery_photo"] - PRIOR["NR.delivery_photo"]) < Math.abs(loose["NR.delivery_photo"] - PRIOR["NR.delivery_photo"]));
  });

  test("returns finite values for every weight key", () => {
    const w = fit(examples(50, ["NR.delivered_to_address", "NR.signature"], 25));
    assert.deepEqual(Object.keys(w).sort(), Object.keys(PRIOR).sort());
    assert.ok(Object.values(w).every(Number.isFinite));
  });

  test("the demo's hidden truth differs from the starting rules", () => {
    assert.notEqual(DEMO_TRUTH["NR.delivery_photo"], PRIOR["NR.delivery_photo"]);
  });
});
