import { NextResponse } from "next/server";
import { assess } from "@/lib/assess";
import { reactToBuyerReplies } from "@/lib/intake";
import { summarize } from "@/lib/summarize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const first = await assess(id);
    await reactToBuyerReplies([summarize(first.caseFile.dispute)]);
    const { caseFile, record, ...rest } = first;
    const { dispute, ...file } = caseFile;
    return NextResponse.json({ dispute, case: record, caseFile: file, ...rest });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
