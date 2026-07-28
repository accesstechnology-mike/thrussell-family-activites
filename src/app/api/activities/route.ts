import { NextRequest, NextResponse } from "next/server";
import {
  matchesOutingKindFilter,
  outingKind,
  type OutingKindFilter,
} from "@/lib/outing-kind";
import { listActivities } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const feature = searchParams.get("feature");
  const q = searchParams.get("q");
  const freeOnly =
    searchParams.get("free") === "1" || searchParams.get("freeOnly") === "1";
  const kindRaw = searchParams.get("kind");
  const kind: OutingKindFilter =
    kindRaw === "walks" || kindRaw === "attractions" ? kindRaw : "all";
  const maxDriveRaw = searchParams.get("maxDrive");
  const maxDrive = maxDriveRaw ? Number(maxDriveRaw) : null;

  const { store, activities: listed } = await listActivities({
    feature,
    q,
    freeOnly,
    maxDrive: Number.isFinite(maxDrive) ? maxDrive : null,
  });
  const activities = listed.filter((a) =>
    matchesOutingKindFilter(outingKind(a), kind),
  );

  const features = [
    ...new Set(store.activities.flatMap((a) => a.features)),
  ].sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    syncedAt: store.syncedAt,
    originPostcode: store.originPostcode,
    maxDriveMinutes: store.maxDriveMinutes,
    count: activities.length,
    features,
    sourceStatuses: store.sourceStatuses,
    activities: activities.map((a) => ({
      id: a.id,
      source: a.source,
      title: a.title,
      summary: a.summary,
      imageUrl: a.imageUrl,
      imageAlt: a.imageAlt,
      locationLabel: a.locationLabel,
      driveMinutes: a.driveMinutes,
      terrain: a.terrain,
      features: a.features,
      cost: a.cost,
      isFree: a.isFree,
      kind: outingKind(a),
      distanceMiles: a.distanceMiles,
      categories: a.categories,
      sourceUrl: a.sourceUrl,
    })),
  });
}
