// Missed and repeated webhooks: the dispute list catches disputes PayPal never
// told us about, and a redelivered CREATED event leaves a decided case alone.

import "./helpers/sandbox";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { onDisputeCreated } from "@/lib/intake";
import { missedDisputes, watchingSince } from "@/lib/reconcile";
import { getCase, updateCase } from "@/lib/store";
import type { CaseRecord } from "@/lib/types";
import { decision } from "./helpers/factory";

const since = Date.parse("2026-10-01T00:00:00Z");
const dispute = (id: string, createdAt: string, status = "WAITING_FOR_SELLER_RESPONSE") => ({ id, status, createdAt });
const caseFor = (disputeId: string) => ({ disputeId }) as CaseRecord;

describe("missedDisputes", () => {
  test("picks open disputes created while watching that have no case", () => {
    const ids = missedDisputes(
      [
        dispute("NEW", "2026-10-02T00:00:00Z"),
        dispute("OLD", "2026-09-30T00:00:00Z"),
        dispute("HANDLED", "2026-10-02T00:00:00Z"),
        dispute("CLOSED", "2026-10-02T00:00:00Z", "RESOLVED"),
      ],
      { HANDLED: caseFor("HANDLED") },
      since,
    );
    assert.deepEqual(ids, ["NEW"]);
  });

  test("ignores disputes without a usable creation time", () => {
    assert.deepEqual(missedDisputes([dispute("X", "")], {}, since), []);
  });
});

describe("watchingSince", () => {
  test("is recorded once and kept", async () => {
    const first = await watchingSince(1000);
    assert.equal(first, 1000);
    assert.equal(await watchingSince(5000), 1000);
  });
});

describe("onDisputeCreated", () => {
  test("a redelivered webhook doesn't restart a decided case", async () => {
    await updateCase("PP-D-1001", (c) => ({ ...c, status: "awaiting_approval", decision: decision(), investigatedAt: new Date().toISOString() }));
    assert.equal(await onDisputeCreated("PP-D-1001"), false);
    const c = await getCase("PP-D-1001");
    assert.equal(c?.status, "awaiting_approval");
    assert.ok(c?.decision);
  });
});
