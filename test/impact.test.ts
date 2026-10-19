import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeImpact, expectedValue } from "@/lib/impact";
import { ago, ahead, assumptionsFixture, decision, record, summary } from "./helpers/factory";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

describe("expectedValue", () => {
  test("refund cost is the amount plus two minutes of time", () => {
    const ev = expectedValue(100, 0.5, assumptionsFixture());
    close(ev.timeCostRefund, 1);
    close(ev.refundCost, 101);
  });

  test("fee charged on loss: fight cost is (1-p)(amount+fee) plus review time", () => {
    const ev = expectedValue(100, 0.8, assumptionsFixture());
    close(ev.timeCostFight, 5);
    close(ev.fightCost, 0.2 * 115 + 5);
    close(ev.fightEdge, ev.refundCost - ev.fightCost);
  });

  test("fee charged always: the fee is paid even on a win", () => {
    const ev = expectedValue(100, 0.8, assumptionsFixture({ feeWhen: "always" }));
    close(ev.fightCost, 0.2 * 100 + 15 + 5);
  });

  test("at the break-even probability fighting and refunding cost the same", () => {
    for (const feeWhen of ["lost", "always"] as const) {
      const a = assumptionsFixture({ feeWhen });
      const { breakEven } = expectedValue(100, 0, a);
      close(expectedValue(100, breakEven, a).fightEdge, 0);
    }
  });

  test("returned 'not as described' items recover part of the price", () => {
    const ev = expectedValue(100, 0.5, assumptionsFixture(), "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED");
    close(ev.recovery, 50);
    close(ev.refundCost, 51);
    close(expectedValue(100, 0.5, assumptionsFixture(), "UNAUTHORISED").recovery, 0);
  });

  test("break-even is 1 when there is nothing to lose and is clamped to [0,1]", () => {
    assert.equal(expectedValue(100, 0.5, assumptionsFixture({ returnRecoveryPct: 100 }), "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED").breakEven, 1);
    assert.equal(expectedValue(5, 0.5, assumptionsFixture({ feeWhen: "always", disputeFee: 20 })).breakEven, 1);
  });

  test("small disputes are not worth fighting, large ones with good odds are", () => {
    assert.ok(expectedValue(10, 0.6, assumptionsFixture()).fightEdge < 0);
    assert.ok(expectedValue(500, 0.6, assumptionsFixture()).fightEdge > 0);
  });
});

describe("computeImpact", () => {
  const rows = [
    // Fought, PayPal ruled for the seller.
    { ...summary({ id: "A", status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" }), case: record({ disputeId: "A", status: "executed", execution: { action: "FIGHT" as const, at: ago(1), ok: true, detail: "" } }) },
    // Buyer withdrew.
    { ...summary({ id: "B", amount: { currency_code: "USD", value: "50.00" }, status: "RESOLVED", outcome: "CANCELED_BY_BUYER" }), case: record({ disputeId: "B", decision: decision({ action: "ACCEPT", win_probability: 0.2 }) }) },
    // Fight submitted, waiting for PayPal; auto-approved.
    { ...summary({ id: "C", status: "UNDER_REVIEW" }), case: record({ disputeId: "C", status: "executed", decision: decision({ win_probability: 0.6 }), execution: { action: "FIGHT" as const, at: ago(0), ok: true, detail: "", auto: "rule" } }) },
    // Fight waiting for approval.
    { ...summary({ id: "D", sellerResponseDueDate: ahead(3) }), case: record({ disputeId: "D", decision: decision({ win_probability: 0.5 }) }) },
    // Not investigated.
    { ...summary({ id: "E" }), case: null },
  ];
  const impact = computeImpact(rows, assumptionsFixture());

  test("counts decided disputes and hours saved", () => {
    assert.equal(impact.handled, 4);
    close(impact.hoursSaved, (4 * 45) / 60);
  });

  test("recovered money counts wins and withdrawals in full", () => {
    close(impact.recovered, 150);
    assert.equal(impact.withdrawn, 1);
  });

  test("open fights count at expected value, split by whether they were executed", () => {
    close(impact.protectedApproved, 150 + 100 * 0.6);
    close(impact.protectedPending, 100 * 0.5);
  });

  test("tracks executions, deadlines met and autonomous actions", () => {
    assert.equal(impact.executed, 2);
    assert.equal(impact.deadlinesMet, 2);
    assert.equal(impact.autoActed, 1);
  });

  test("projected win rate averages the fights' estimates", () => {
    close(impact.projectedWinRate!, (0.7 + 0.6 + 0.5) / 3);
  });

  test("next deadline is the soonest open, unexecuted one", () => {
    assert.ok(impact.nextDeadlineDays! > 2.9 && impact.nextDeadlineDays! < 3.1);
  });

  test("empty input gives zeros and nulls", () => {
    const none = computeImpact([], assumptionsFixture());
    assert.equal(none.handled, 0);
    assert.equal(none.projectedWinRate, null);
    assert.equal(none.nextDeadlineDays, null);
  });
});
