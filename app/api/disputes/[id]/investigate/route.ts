import { NextResponse } from "next/server";
import { investigate } from "@/lib/agent";
import { maybeActAlone } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const decision = await investigate(id);
    const auto = await maybeActAlone(id);
    return NextResponse.json({ decision, auto });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
