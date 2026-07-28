import { HOME_POSTCODE, MAX_DRIVE_MINUTES } from "../config";
import { getDriveTimesMinutes } from "../drive-times";
import { getOrigin } from "../origin";
import { writeStore } from "../store";
import type { Activity, SourceStatus, SyncResult } from "../types";
import { fetchEnglishHeritage } from "./english-heritage";
import { fetchNationalTrust } from "./national-trust";
import { fetchReluctantExplorers } from "./reluctant-explorers";

function dedupe(activities: Activity[]): Activity[] {
  const byKey = new Map<string, Activity>();
  for (const activity of activities) {
    const key = `${activity.sourceUrl}|${activity.title.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, activity);
      continue;
    }
    // Prefer the richer record (more features / image / parking).
    const score = (a: Activity) =>
      (a.imageUrl ? 2 : 0) +
      (a.parking ? 1 : 0) +
      (a.what3words ? 1 : 0) +
      a.features.length;
    if (score(activity) > score(existing)) byKey.set(key, activity);
  }
  return [...byKey.values()];
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
  // ~90 minutes driving ≈ ~80 miles upper bound for NT radius search
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

  const merged = dedupe([
    ...tre.activities,
    ...nt.activities,
    ...eh.activities,
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

  const statuses: SourceStatus[] = [tre.status, nt.status, eh.status].map(
    (status) => ({
      ...status,
      kept: withinRange.filter((a) => a.source === status.source).length,
    }),
  );

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
