import { NextResponse } from "next/server";
import { onDisputeCreated } from "@/lib/intake";
import { DEMO_TRUTH } from "@/lib/learning";
import { clearSimulated, resolveDispute, SCENARIOS, simulateDispute, type ScenarioId } from "@/lib/mock";
import { provider } from "@/lib/paypal";
import { scoreFeatures, type FeatureKey, type Group } from "@/lib/score";
import { allCases, deleteCases } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const demoOnly = () =>
  NextResponse.json({ error: "Simulated disputes only exist in demo mode (PAYPAL_MODE=mock)." }, { status: 400 });

export async function GET() {
  return NextResponse.json({ enabled: provider().mode === "mock", scenarios: SCENARIOS });
}

// Creates a demo dispute and hands it to the same intake as a PayPal webhook.
export async function POST(req: Request) {
  if (provider().mode !== "mock") return demoOnly();
  const body = (await req.json().catch(() => ({}))) as { scenario?: string };
  const scenario = SCENARIOS.find((s) => s.id === body.scenario)?.id as ScenarioId | undefined;
  const created = simulateDispute(scenario);
  onDisputeCreated(created.disputeId);
  return NextResponse.json(created);
}

// Clears every simulated dispute and its case record, for a fresh demo run.
export async function DELETE() {
  if (provider().mode !== "mock") return demoOnly();
  const ids = clearSimulated();
  await deleteCases(ids);
  return NextResponse.json({ removed: ids });
}

// Demo only: PayPal rules on every dispute under review. Outcomes are drawn
// from the demo's hidden "true" weights, not the app's estimate, so the Track
// record page shows honestly how well the estimates did.
export async function PATCH() {
  if (provider().mode !== "mock") return demoOnly();
  const [disputes, cases] = await Promise.all([provider().listDisputes(), allCases()]);
  const ruled: { id: string; sellerWins: boolean; predicted: number | null }[] = [];
  for (const d of disputes) {
    if (d.status !== "UNDER_REVIEW") continue;
    const pred = cases[d.id]?.prediction;
    const p = pred
      ? scoreFeatures(pred.group as Group, pred.features.map((k) => k.split(".")[1] as FeatureKey), DEMO_TRUTH)
      : 0.5;
    const sellerWins = Math.random() < p;
    resolveDispute(d.id, sellerWins);
    ruled.push({ id: d.id, sellerWins, predicted: pred?.p ?? null });
  }
  return NextResponse.json({ ruled });
}
