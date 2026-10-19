import { NextResponse } from "next/server";
import { learnedModel } from "@/lib/learning";
import { provider } from "@/lib/paypal";

export const dynamic = "force-dynamic";

// How well the win estimates matched PayPal's actual rulings, and what the model learned.
export async function GET() {
  try {
    const { report } = await learnedModel();
    return NextResponse.json({ mode: provider().mode, report });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
