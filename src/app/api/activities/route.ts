import { NextRequest, NextResponse } from "next/server";
import { serializeActivity } from "@/lib/agent";
import {
  matchesOutingKindFilter,
  outingKind,
  type OutingKindFilter,
} from "@/lib/outing-kind";
import {
  catalogueFromStore,
  isSource,
  isTerrain,
  parseBooleanFlag,
  parseCsv,
  parsePositiveInt,
  type ActivitySort,
  type ActivityView,
} from "@/lib/query";
import { listActivities } from "@/lib/store";
import type { ActivitySource, TerrainLevel } from "@/lib/types";

export const runtime = "nodejs";

function parseSort(value: string | null): ActivitySort {
  if (
    value === "title" ||
    value === "distance" ||
    value === "recent" ||
    value === "drive"
  ) {
    return value;
  }
  return "drive";
}

function parseView(value: string | null): ActivityView {
  return value === "full" ? "full" : "card";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const feature = searchParams.get("feature");
  const features = parseCsv(searchParams.get("features"));
  const sourceRaw = searchParams.get("source");
  const sourcesRaw = parseCsv(searchParams.get("sources"));
  const terrainRaw = searchParams.get("terrain");
  const terrainsRaw = parseCsv(searchParams.get("terrains"));
  const q = searchParams.get("q");
  const ids = parseCsv(searchParams.get("ids"));

  if (sourceRaw && !isSource(sourceRaw)) {
    return NextResponse.json(
      { error: `Unknown source: ${sourceRaw}` },
      { status: 400 },
    );
  }
  for (const s of sourcesRaw) {
    if (!isSource(s)) {
      return NextResponse.json({ error: `Unknown source: ${s}` }, { status: 400 });
    }
  }
  if (terrainRaw && !isTerrain(terrainRaw)) {
    return NextResponse.json(
      { error: `Unknown terrain: ${terrainRaw}` },
      { status: 400 },
    );
  }
  for (const t of terrainsRaw) {
    if (!isTerrain(t)) {
      return NextResponse.json({ error: `Unknown terrain: ${t}` }, { status: 400 });
    }
  }

  const maxDrive = parsePositiveInt(searchParams.get("maxDrive"));
  const minDrive = parsePositiveInt(searchParams.get("minDrive"));
  const maxDistanceMilesRaw = searchParams.get("maxDistanceMiles");
  const maxDistanceMiles =
    maxDistanceMilesRaw != null && maxDistanceMilesRaw !== ""
      ? Number(maxDistanceMilesRaw)
      : null;
  const limit = parsePositiveInt(searchParams.get("limit"));
  const offset = parsePositiveInt(searchParams.get("offset")) ?? 0;
  const freeOnly =
    parseBooleanFlag(searchParams.get("free")) ||
    parseBooleanFlag(searchParams.get("freeOnly"));
  const kindRaw = searchParams.get("kind");
  const kind: OutingKindFilter =
    kindRaw === "walks" || kindRaw === "attractions" ? kindRaw : "all";
  const sort = parseSort(searchParams.get("sort"));
  const view = parseView(searchParams.get("view"));

  const { store, activities: listed, applied } = await listActivities({
    feature,
    features,
    source: sourceRaw as ActivitySource | null,
    sources: sourcesRaw as ActivitySource[],
    terrain: terrainRaw as TerrainLevel | null,
    terrains: terrainsRaw as TerrainLevel[],
    q,
    ids,
    maxDrive,
    minDrive,
    maxDistanceMiles:
      maxDistanceMiles != null && Number.isFinite(maxDistanceMiles)
        ? maxDistanceMiles
        : null,
    freeOnly,
    sort,
    // Apply kind filter before pagination so limit/offset stay correct.
    limit: undefined,
    offset: undefined,
  });

  const kindFiltered = listed.filter((a) =>
    matchesOutingKindFilter(outingKind(a), kind),
  );
  const total = kindFiltered.length;
  const start = offset ?? 0;
  const activities =
    limit != null ? kindFiltered.slice(start, start + limit) : kindFiltered.slice(start);

  const catalogue = catalogueFromStore(store);

  return NextResponse.json({
    syncedAt: store.syncedAt,
    originPostcode: store.originPostcode,
    maxDriveMinutes: store.maxDriveMinutes,
    count: activities.length,
    total,
    view,
    applied: { ...applied, kind, limit: limit ?? null, offset: start },
    features: catalogue.features,
    sources: catalogue.sources,
    terrains: catalogue.terrains,
    categories: catalogue.categories,
    sourceStatuses: store.sourceStatuses,
    activities: activities.map((a) => ({
      ...serializeActivity(a, view),
      kind: outingKind(a),
    })),
  });
}
