import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { orderIdOf } from "@/lib/casefile";
import { uploadPath } from "@/lib/collect";
import { daysUntil, humanStatus, money, reasonLabel } from "@/lib/format";
import { summarize } from "@/lib/summarize";
import { ahead } from "./helpers/factory";

describe("format", () => {
  test("reasonLabel names known reasons and passes unknown ones through", () => {
    assert.equal(reasonLabel("UNAUTHORISED"), "Unauthorized");
    assert.equal(reasonLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  });

  test("money formats currency and handles missing values", () => {
    assert.equal(money({ currency_code: "USD", value: "86" }), "$86.00");
    assert.equal(money(null), "");
  });

  test("daysUntil rounds up and handles null", () => {
    assert.equal(daysUntil(ahead(2.5)), 3);
    assert.equal(daysUntil(null), null);
  });

  test("humanStatus lowercases and removes underscores", () => {
    assert.equal(humanStatus("WAITING_FOR_SELLER_RESPONSE"), "waiting for seller response");
  });
});

describe("summarize", () => {
  test("flattens a PayPal dispute for the dashboard", () => {
    const s = summarize({
      dispute_id: "PP-1",
      reason: "UNAUTHORISED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      dispute_amount: { currency_code: "USD", value: "240.00" },
      create_time: "2026-10-01T00:00:00Z",
      disputed_transactions: [{ seller_transaction_id: "CAP", buyer: { name: "Dana" }, items: [{ item_name: "Favors", item_quantity: "2" }] }],
      messages: [
        { posted_by: "BUYER", content: "first", time_posted: "2026-10-01T00:00:00Z" },
        { posted_by: "SELLER", content: "reply", time_posted: "2026-10-02T00:00:00Z" },
        { posted_by: "BUYER", content: "second", time_posted: "2026-10-03T00:00:00Z" },
      ],
    });
    assert.equal(s.id, "PP-1");
    assert.equal(s.stage, "");
    assert.equal(s.sellerTransactionId, "CAP");
    assert.deepEqual(s.items, [{ name: "Favors", quantity: 2 }]);
    assert.equal(s.firstBuyerMessage, "first");
    assert.equal(s.lastBuyerMessageAt, "2026-10-03T00:00:00Z");
    assert.equal(s.outcome, null);
  });

  test("tolerates a dispute with no transactions or messages", () => {
    const s = summarize({ dispute_id: "PP-2", reason: "OTHER", status: "OPEN" });
    assert.deepEqual(s.items, []);
    assert.equal(s.buyerName, null);
    assert.equal(s.firstBuyerMessage, null);
  });
});

describe("orderIdOf", () => {
  test("reads the order ID from mock data or PayPal's 'up' link", () => {
    assert.equal(orderIdOf({ supplementary_data: { related_ids: { order_id: "O-1" } } }), "O-1");
    assert.equal(orderIdOf({ links: [{ rel: "up", href: "https://api/v2/checkout/orders/5O1234?x=1" }] }), "5O1234");
    assert.equal(orderIdOf(null), null);
  });
});

describe("uploadPath", () => {
  test("keeps stored paths inside data/uploads", () => {
    const root = path.join(process.cwd(), "data", "uploads");
    assert.equal(uploadPath("PP-1/pod.pdf"), path.join(root, "PP-1", "pod.pdf"));
    assert.ok(uploadPath("../../etc/passwd").startsWith(root));
  });
});
