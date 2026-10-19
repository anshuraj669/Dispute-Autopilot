import { buildEvidencePacket } from "@/lib/packet";

export const dynamic = "force-dynamic";

// Preview of the evidence packet PDF that goes to PayPal with a FIGHT decision.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name, data } = await buildEvidencePacket(id);
    return new Response(data as BodyInit, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
  }
}
