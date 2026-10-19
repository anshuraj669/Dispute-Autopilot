import "./helpers/sandbox";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { defaults, getSettings, saveSettings } from "@/lib/settings";

describe("settings", () => {
  test("falls back to defaults when nothing is saved", async () => {
    const s = await getSettings();
    assert.deepEqual(s, defaults());
    assert.equal(s.autonomy, "suggest");
    assert.equal(s.requireDeliveryProof, true);
  });

  test("saves a valid partial update and keeps the rest", async () => {
    const s = await saveSettings({ autonomy: "auto_small", autoLimit: 40, merchantName: "  Test Shop  " });
    assert.equal(s.autonomy, "auto_small");
    assert.equal(s.autoLimit, 40);
    assert.equal(s.merchantName, "Test Shop");
    assert.ok(existsSync("data/settings.json"));
    assert.deepEqual(await getSettings(), s);
  });

  test("rejects out-of-range numbers and unknown choices", async () => {
    await assert.rejects(saveSettings({ autoLimit: -1 }), /number from 0/);
    await assert.rejects(saveSettings({ returnRecoveryPct: 101 }), /number from 0 to 100/);
    await assert.rejects(saveSettings({ disputeFee: "abc" }), /number/);
    await assert.rejects(saveSettings({ autonomy: "yolo" }), /autonomy must be/);
    await assert.rejects(saveSettings({ feeWhen: "sometimes" }), /feeWhen must be/);
    await assert.rejects(saveSettings({ merchantName: "   " }), /expected text/);
  });

  test("a rejected update saves nothing", async () => {
    const before = await getSettings();
    await assert.rejects(saveSettings({ autoLimit: 50, hourlyRate: 5000 }));
    assert.deepEqual(await getSettings(), before);
  });
});
