import { HOME_POSTCODE, MAX_DRIVE_MINUTES } from "../config";
import { activityHasSource, mergeDuplicateActivities } from "../dedupe";
import { getDriveTimesMinutes } from "../drive-times";
import { withFreeFlag } from "../free";
import { enrichActivityImages } from "../images";
import { getOrigin } from "../origin";
import { writeStore } from "../store";
import type { Activity, SourceStatus, SyncResult } from "../types";
import { fetchAllTrailsKids } from "./alltrails";
import { fetchDogFriendly } from "./dog-friendly";
import { fetchEnglishHeritage } from "./english-heritage";
import { fetchLittleVikings } from "./little-vikings";
import { fetchMuddyBootsMummy } from "./muddy-boots-mummy";
import { fetchNationalTrust } from "./national-trust";
import { fetchOpenStreetMapAttractions } from "./openstreetmap";
import { fetchOutdoorGuide } from "./outdoor-guide";
import { fetchReluctantExplorers } from "./reluctant-explorers";
import { fetchTeessideFamilyLife } from "./teesside-family-life";
import { fetchWalkiees } from "./walkiees";
import { fetchWhere2walk } from "./where2walk";
import { fetchYorkshireTots } from "./yorkshire-tots";

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

function ensureIsFree(activity: Activity): Activity {
  if (activity.isFree != null) return activity;
  return { ...activity, isFree: null };
}

export async function syncAllSources(): Promise<SyncResult> {
  const origin = await getOrigin();
  const radiusMiles = 80;

  const [tre, nt, eh, osm] = await Promise.all([
    runSource("reluctant-explorers", () => fetchReluctantExplorers()),
    runSource("national-trust", () =>
      fetchNationalTrust(origin.location, radiusMiles),
    ),
    runSource("english-heritage", () =>
      fetchEnglishHeritage(origin.location),
    ),
    runSource("openstreetmap", () =>
      fetchOpenStreetMapAttractions(origin.location),
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
  const wk = await runSource("walkiees", () => fetchWalkiees());
  const tog = await runSource("outdoor-guide", () => fetchOutdoorGuide());
  const df = await runSource("dog-friendly", () =>
    fetchDogFriendly(origin.location),
  );
  const w2w = await runSource("where2walk", () => fetchWhere2walk());

  const { activities: merged, stats: dedupeStats } = mergeDuplicateActivities(
    [
      ...tre.activities,
      ...nt.activities,
      ...eh.activities,
      ...osm.activities,
      ...yt.activities,
      ...tfl.activities,
      ...mbm.activities,
      ...lv.activities,
      ...at.activities,
      ...wk.activities,
      ...tog.activities,
      ...df.activities,
      ...w2w.activities,
    ].map(ensureIsFree),
  );
  console.log(
    `Place merge: ${dedupeStats.before} listings → ${dedupeStats.after} cards (${dedupeStats.clusters} clusters, ${dedupeStats.listingsMerged} listings merged)`,
  );

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
    )
    .map(withFreeFlag);

  // Wikipedia fill + local webp cache (suitable card/detail sizes)
  console.log(`Caching images for ${withinRange.length} activities…`);
  const withImages = await enrichActivityImages(withinRange);

  const statuses: SourceStatus[] = [
    tre.status,
    nt.status,
    eh.status,
    osm.status,
    yt.status,
    tfl.status,
    mbm.status,
    lv.status,
    at.status,
    wk.status,
    tog.status,
    df.status,
    w2w.status,
  ].map((status) => ({
    ...status,
    kept: withImages.filter((a) => activityHasSource(a, status.source)).length,
  }));

  const store = {
    version: 1 as const,
    originPostcode: origin.postcode || HOME_POSTCODE,
    origin: origin.location,
    maxDriveMinutes: MAX_DRIVE_MINUTES,
    syncedAt: new Date().toISOString(),
    activities: withImages.sort(
      (a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0),
    ),
    sourceStatuses: statuses,
  };

  await writeStore(store);
  return { store, statuses };
}
