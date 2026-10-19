import { NextResponse } from "next/server";
import { addCollected, removeCollected } from "@/lib/collect";
import { COLLECTABLE, type CollectKey } from "@/lib/evidence";
import { reinvestigate } from "@/lib/intake";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Adds a piece of evidence the merchant collected (a note and an optional
// file), then has the agent reconsider the case with it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const item = await addCollected(id, String(form.get("key") ?? ""), String(form.get("note") ?? ""), file instanceof File && file.size ? file : null);
    reinvestigate(id, `The merchant added evidence: ${COLLECTABLE[item.key as CollectKey].label.toLowerCase()}${item.file ? " (file attached)" : ""}.`);
    return NextResponse.json({ collected: item });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await removeCollected(id, new URL(req.url).searchParams.get("key") ?? "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
