import { NextResponse } from "next/server";
import { sendBuyerMessage } from "@/lib/messaging";

export const dynamic = "force-dynamic";

// Sends a merchant-approved message to the buyer through the dispute thread.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { content } = (await req.json()) as { content?: string };
    return NextResponse.json({ case: await sendBuyerMessage(id, content ?? "") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
