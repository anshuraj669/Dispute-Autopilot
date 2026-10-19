import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await getSettings() });
}

export async function PUT(req: Request) {
  try {
    return NextResponse.json({ settings: await saveSettings(await req.json()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
