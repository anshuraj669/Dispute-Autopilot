import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertAllowed, permissions } from "@/lib/guard";
import { ago, ahead } from "./helpers/factory";

const links = (...rels: string[]) => [{ rel: "self" }, ...rels.map((rel) => ({ rel }))];

const dispute = (over: Record<string, unknown> = {}) => ({
  status: "WAITING_FOR_SELLER_RESPONSE",
  dispute_life_cycle_stage: "INQUIRY",
  seller_response_due_date: ahead(5),
  links: links("accept_claim", "provide_evidence", "send_message"),
  ...over,
});

describe("permissions", () => {
  test("allows every action PayPal offers a link for", () => {
    const p = permissions(dispute());
    assert.ok(p.FIGHT.allowed && p.ACCEPT.allowed && p.MESSAGE.allowed);
    assert.deepEqual(p.links, ["accept_claim", "provide_evidence", "send_message"]);
    assert.equal(p.deadlinePassed, false);
  });

  test("blocks an action whose link is missing and says why", () => {
    const p = permissions(dispute({ status: "UNDER_REVIEW", links: links("accept_claim", "send_message") }));
    assert.equal(p.FIGHT.allowed, false);
    assert.match(p.FIGHT.why, /doesn't offer "submit evidence"/);
    assert.ok(p.ACCEPT.allowed);
  });

  test("points to API permissions when PayPal lists no actions", () => {
    assert.match(permissions(dispute({ links: [] })).FIGHT.why, /check the app's dispute permissions/);
  });

  test("a passed deadline blocks fighting and accepting but not messaging", () => {
    const p = permissions(dispute({ seller_response_due_date: ago(1) }));
    assert.equal(p.deadlinePassed, true);
    assert.equal(p.FIGHT.allowed, false);
    assert.equal(p.ACCEPT.allowed, false);
    assert.ok(p.MESSAGE.allowed);
  });

  test("a resolved dispute allows nothing", () => {
    const p = permissions(dispute({ status: "RESOLVED" }));
    assert.ok(!p.FIGHT.allowed && !p.ACCEPT.allowed && !p.MESSAGE.allowed);
    assert.equal(p.MESSAGE.why, "The dispute is closed.");
  });

  test("uses the `now` argument for the deadline", () => {
    const d = dispute({ seller_response_due_date: "2026-01-10T00:00:00Z" });
    assert.ok(permissions(d, Date.parse("2026-01-09T00:00:00Z")).FIGHT.allowed);
    assert.ok(!permissions(d, Date.parse("2026-01-11T00:00:00Z")).FIGHT.allowed);
  });
});

describe("assertAllowed", () => {
  test("passes when allowed and throws PayPal's reason when not", () => {
    assert.doesNotThrow(() => assertAllowed(dispute(), "FIGHT"));
    assert.throws(() => assertAllowed(dispute({ status: "RESOLVED" }), "MESSAGE"), /Can't message the buyer: The dispute is closed/);
  });
});
