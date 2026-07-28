import { HOME_POSTCODE, MAX_DRIVE_MINUTES } from "../config";
import { getDriveTimesMinutes } from "../drive-times";
import { getOrigin } from "../origin";
import { writeStore } from "../store";
import type { Activity, SourceStatus, SyncResult } from "../types";
import { fetchAllTrailsKids } from "./alltrails";
import { fetchEnglishHeritage } from "./english-heritage";
import { haversineKm, normalisedPlaceKey } from "./listicle";
import { fetchLittleVikings } from "./little-vikings";
import { fetchMuddyBootsMummy } from "./muddy-boots-mummy";
import { fetchNationalTrust } from "./national-trust";
import { fetchReluctantExplorers } from "./reluctant-explorers";
import { fetchTeessideFamilyLife } from "./teesside-family-life";
import { fetchYorkshireTots } from "./yorkshire-tots";

function scoreActivity(a: Activity): number {
  // Prefer detailed primary sources over listicle blurbs when places overlap.
  const sourceBoost =
    a.source === "reluctant-explorers"
      ? 50
      : a.source === "national-trust"
        ? 20
        : a.source === "yorkshire-tots"
          ? 10
          : 0;
  return (
    sourceBoost +
    (a.imageUrl ? 2 : 0) +
    (a.parking ? 2 : 0) +
    (a.what3words ? 4 : 0) +
    (a.distanceMiles != null ? 1 : 0) +
    Math.min(a.features.length, 6)
  );
}

/** Collapse same place across sources by normalised title and/or proximity. */
function dedupe(activities: Activity[]): Activity[] {
  const kept: Activity[] = [];

  for (const activity of activities) {
    const key = normalisedPlaceKey(activity.title);
    const duplicateIndex = kept.findIndex((existing) => {
      const existingKey = normalisedPlaceKey(existing.title);
      if (key && existingKey && key === existingKey) return true;
      if (
        key &&
        existingKey &&
        key !== existingKey &&
        (key.includes(existingKey) || existingKey.includes(key)) &&
        Math.min(key.length, existingKey.length) >= 10
      ) {
        return haversineKm(existing.coordinates, activity.coordinates) < 2;
      }
      return (
        haversineKm(existing.coordinates, activity.coordinates) < 0.45 &&
        tokenOverlap(existingKey, key) >= 0.5
      );
    });

    if (duplicateIndex < 0) {
      kept.push(activity);
      continue;
    }

    if (scoreActivity(activity) > scoreActivity(kept[duplicateIndex]!)) {
      kept[duplicateIndex] = activity;
    }
  }

  return kept;
}

function tokenOverlap(a: string, b: string): number {
  const as = new Set(a.split(" ").filter((t) => t.length > 2));
  const bs = new Set(b.split(" ").filter((t) => t.length > 2));
  if (!as.size || !bs.size) return 0;
  let overlap = 0;
  for (const t of as) if (bs.has(t)) overlap += 1;
  return overlap / Math.max(as.size, bs.size);
}

async function runSource(
  source: SourceStatus["source"],
  fn: () => Promise<Activity[]>,
): Promise<{ activities: Activity[]; status: SourceStatus }> {
  const finishedAt = new Date().toISOString();
  try {
    const activities = await fn();
    return {
      activities,
      status: {
        source,
        ok: true,
        fetched: activities.length,
        kept: activities.length,
        error: null,
        finishedAt,
      },
    };
  } catch (err) {
    return {
      activities: [],
      status: {
        source,
        ok: false,
        fetched: 0,
        kept: 0,
        error: err instanceof Error ? err.message : String(err),
        finishedAt,
      },
    };
  }
}

export async function syncAllSources(): Promise<SyncResult> {
  const origin = await getOrigin();
  const radiusMiles = 80;

  const [tre, nt, eh] = await Promise.all([
    runSource("reluctant-explorers", () => fetchReluctantExplorers()),
    runSource("national-trust", () =>
      fetchNationalTrust(origin.location, radiusMiles),
    ),
    runSource("english-heritage", () =>
      fetchEnglishHeritage(origin.location),
    ),
  ]);

  // Blog / CF-prone sources sequential
  const yt = await runSource("yorkshire-tots", () => fetchYorkshireTots());
  const tfl = await runSource("teesside-family-life", () =>
    fetchTeessideFamilyLife(),
  );
  const mbm = await runSource("muddy-boots-mummy", () =>
    fetchMuddyBootsMummy(),
  );
  const lv = await runSource("little-vikings", () => fetchLittleVikings());
  const at = await runSource("alltrails", () => fetchAllTrailsKids());

  const merged = dedupe([
    ...tre.activities,
    ...nt.activities,
    ...eh.activities,
    ...yt.activities,
    ...tfl.activities,
    ...mbm.activities,
    ...lv.activities,
    ...at.activities,
  ]);

  const driveTimes = await getDriveTimesMinutes(
    origin.location,
    merged.map((a) => ({ id: a.id, location: a.coordinates })),
  );

  const withinRange = merged
    .map((a) => ({
      ...a,
      driveMinutes: driveTimes[a.id] ?? null,
    }))
    .filter(
      (a) => a.driveMinutes != null && a.driveMinutes <= MAX_DRIVE_MINUTES,
    );

  const statuses: SourceStatus[] = [
    tre.status,
    nt.status,
    eh.status,
    yt.status,
    tfl.status,
    mbm.status,
    lv.status,
    at.status,
  ].map((status) => ({
    ...status,
    kept: withinRange.filter((a) => a.source === status.source).length,
  }));

  const store = {
    version: 1 as const,
    originPostcode: origin.postcode || HOME_POSTCODE,
    origin: origin.location,
    maxDriveMinutes: MAX_DRIVE_MINUTES,
    syncedAt: new Date().toISOString(),
    activities: withinRange.sort(
      (a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0),
    ),
    sourceStatuses: statuses,
  };

  await writeStore(store);
  return { store, statuses };
}
