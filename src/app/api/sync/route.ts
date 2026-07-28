import { NextResponse } from "next/server";
import { syncAllSources } from "@/lib/sources/sync";
import { summariseStatuses } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const result = await syncAllSources();
    return NextResponse.json({
      ok: true,
      syncedAt: result.store.syncedAt,
      count: result.store.activities.length,
      origin: result.store.originPostcode,
      statuses: result.statuses,
      summary: summariseStatuses(result.statuses),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  return GET();
}
