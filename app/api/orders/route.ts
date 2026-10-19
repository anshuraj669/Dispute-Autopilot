import { NextResponse } from "next/server";
import { paypalFetch } from "@/lib/paypal";
import { PRODUCTS } from "@/lib/products";

export const dynamic = "force-dynamic";

const MAX_QUANTITY = 10;

// Demo store checkout (sandbox mode): creates a PayPal order for one product.
export async function POST(req: Request) {
  const { sku, quantity = 1 } = (await req.json()) as { sku: string; quantity?: number };
  const product = PRODUCTS.find((p) => p.sku === sku);
  if (!product) return NextResponse.json({ error: "unknown product" }, { status: 400 });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return NextResponse.json({ error: `quantity must be 1-${MAX_QUANTITY}` }, { status: 400 });
  }
  // Integer cents so 3 x 12.50 is exactly 37.50; PayPal rejects totals that don't match the items.
  const total = ((Math.round(Number(product.price) * 100) * quantity) / 100).toFixed(2);

  try {
    const order = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: total,
              breakdown: { item_total: { currency_code: "USD", value: total } },
            },
            items: [
              {
                name: product.name,
                sku: product.sku,
                quantity: String(quantity),
                category: "PHYSICAL_GOODS",
                unit_amount: { currency_code: "USD", value: product.price },
              },
            ],
          },
        ],
      }),
    });
    return NextResponse.json({ id: order.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
