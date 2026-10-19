import { NextResponse } from "next/server";
import { onDisputeCreated, reactToBuyerReplies } from "@/lib/intake";
import { provider, verifyWebhook } from "@/lib/paypal";
import { summarize } from "@/lib/summarize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// PayPal calls this when a dispute is opened or updated. The agent starts
// investigating right away (and again when the buyer replies), so the merchant
// finds a ready recommendation on the dashboard.
export async function POST(req: Request) {
  let event: any;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!(await verifyWebhook(req.headers, event))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const disputeId: string | undefined = event.resource?.dispute_id;
  if (disputeId && event.event_type === "CUSTOMER.DISPUTE.CREATED") onDisputeCreated(disputeId);
  // A buyer reply arrives as an update; re-investigate if it came after the last decision.
  if (disputeId && event.event_type === "CUSTOMER.DISPUTE.UPDATED") {
    await reactToBuyerReplies([summarize(await provider().getDispute(disputeId))]);
  }
  return NextResponse.json({ received: true });
}
