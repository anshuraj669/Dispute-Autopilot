import { NextResponse } from "next/server";
import { rewriteListing } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { product } = (await req.json()) as { product?: string };
    if (!product) return NextResponse.json({ error: "product is required" }, { status: 400 });
    return NextResponse.json({ listing: await rewriteListing(product) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
