import { NextResponse } from "next/server";
import { buildInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildInsights());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
