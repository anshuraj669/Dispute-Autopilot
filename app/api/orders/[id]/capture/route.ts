import { NextResponse } from "next/server";
import { paypalFetch } from "@/lib/paypal";
import { SHIPPING_CARRIER } from "@/lib/products";
import { recordPurchase, type Purchase } from "@/lib/purchases";

export const dynamic = "force-dynamic";

// Captures an approved order, then attaches a shipment tracker so later
// "item not received" disputes have fulfilment data for the agent to find.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const order = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
      method: "POST",
      body: "{}",
      // Full representation includes the line items and payer, which the purchase log needs.
      headers: { Prefer: "return=representation" },
    });
    const captureId: string = order.purchase_units[0].payments.captures[0].id;
    const trackingNumber = `9400${Date.now()}`.slice(0, 22);
    await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}/track`, {
      method: "POST",
      body: JSON.stringify({ capture_id: captureId, tracking_number: trackingNumber, carrier: SHIPPING_CARRIER, notify_payer: false }),
    });
    const unit = order.purchase_units[0];
    const purchase: Purchase = {
      orderId: id,
      captureId,
      trackingNumber,
      items: (unit.items ?? []).map((i: any) => ({
        sku: i.sku,
        name: i.name,
        quantity: Number(i.quantity),
        unitAmount: i.unit_amount,
      })),
      total: unit.payments.captures[0].amount,
      buyerEmail: order.payer?.email_address ?? null,
      buyerName: [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ") || null,
      purchasedAt: new Date().toISOString(),
    };
    await recordPurchase(purchase);
    return NextResponse.json(purchase);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
