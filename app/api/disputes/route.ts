import { NextResponse } from "next/server";
import { provider } from "@/lib/paypal";
import { allCases } from "@/lib/store";
import { assumptions, computeImpact, expectedValue } from "@/lib/impact";
import { getSettings } from "@/lib/settings";
import { reactToBuyerReplies } from "@/lib/intake";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const disputes = await provider().listDisputes();
    await reactToBuyerReplies(disputes);
    const cases = await allCases();
    const a = assumptions(await getSettings());
    const rows = disputes.map((d) => {
      const c = cases[d.id] ?? null;
      return { ...d, case: c, ev: c?.decision ? expectedValue(Number(d.amount.value), c.decision.win_probability, a, d.reason) : null };
    });
    return NextResponse.json({ mode: provider().mode, assumptions: a, impact: computeImpact(rows, a), disputes: rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
