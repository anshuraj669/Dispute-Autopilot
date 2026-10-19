// Messages to the buyer go through the PayPal dispute thread. Like refunds and
// evidence, they leave the merchant's hands, so they need approval unless the
// merchant lets the agent message on its own.

import { assertAllowed } from "./guard";
import { provider } from "./paypal";
import { updateCase } from "./store";

export async function sendBuyerMessage(disputeId: string, content: string, auto = false) {
  const text = content.trim();
  if (!text) throw new Error("The message is empty.");
  if (text.length > 2000) throw new Error("PayPal messages are limited to 2000 characters.");
  const paypal = provider();
  assertAllowed(await paypal.getDispute(disputeId), "MESSAGE");
  await paypal.sendMessage(disputeId, text);
  return updateCase(disputeId, (c) => ({
    ...c,
    messages: [...(c.messages ?? []), { at: new Date().toISOString(), content: text, auto }],
  }));
}
