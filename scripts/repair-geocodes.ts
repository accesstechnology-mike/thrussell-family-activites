/**
 * Re-pin HTML-sourced walks from the public source page (start lat/lng,
 * OS grid, postcode, what3words). Title→Nominatim is not used here.
 * Drive minutes refresh via the same OSRM table API as sync.
 */
import { MAX_DRIVE_MINUTES } from "../src/lib/config";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import { sleep } from "../src/lib/html";
import { getOrigin } from "../src/lib/origin";
import {
  locationRawFacts,
  resolvePageLocation,
} from "../src/lib/page-location";
import { haversineKm } from "../src/lib/sources/listicle";
import { readStore, writeStore } from "../src/lib/store";
import type { Activity, ActivitySource } from "../src/lib/types";

const PAGE_SOURCES = new Set<ActivitySource>([
  "where2walk",
  "outdoor-guide",
  "yorkshire-tots",
  "teesside-family-life",
  "dog-friendly",
]);

const MOVED_KM = 0.15;

function titleFilter(): string[] {
  return process.argv.slice(2).filter((a) => !a.startsWith("-"));
}

async function main() {
  const store = await readStore();
  const origin = await getOrigin();
  store.origin = origin.location;
  store.originPostcode = origin.postcode;

  const wanted = titleFilter().map((t) => t.toLowerCase());
  const suspects = store.activities.filter((a) => {
    if (!PAGE_SOURCES.has(a.source) || !a.sourceUrl) return false;
    if (!wanted.length) return a.source === "where2walk";
    return wanted.some((t) => a.title.toLowerCase().includes(t));
  });
  console.log(
    `Resolving ${suspects.length} source pages (page lat/lng → OS grid → postcode → what3words)…`,
  );

  const movedIds: string[] = [];
  for (const activity of suspects) {
    const resolved = await resolvePageLocation({ pageUrl: activity.sourceUrl });
    await sleep(200);
    if (!resolved) {
      console.log(`  miss: ${activity.title}`);
      continue;
    }
    const moved = haversineKm(activity.coordinates, resolved);
    const facts = locationRawFacts(resolved);
    activity.rawFacts = { ...activity.rawFacts, ...facts };
    if (resolved.postcode) activity.postcode = resolved.postcode;
    if (resolved.what3words) activity.what3words = resolved.what3words;
    if (moved < MOVED_KM && activity.rawFacts.coordSource === resolved.coordSource) {
      console.log(
        `  keep ${moved.toFixed(2)}km · ${resolved.coordSource}: ${activity.title}`,
      );
      continue;
    }
    console.log(
      `  ${resolved.coordSource} ${moved.toFixed(2)}km: ${activity.title} → ${resolved.lat},${resolved.lng}`,
    );
    activity.coordinates = { lat: resolved.lat, lng: resolved.lng };
    movedIds.push(activity.id);
  }

  const needDrive = new Set(movedIds);
  if (!needDrive.size) {
    await writeStore(store);
    console.log("No pins moved; wrote coordSource facts.");
    return;
  }

  const driveTimes = await getDriveTimesMinutes(
    origin.location,
    store.activities
      .filter((a) => needDrive.has(a.id))
      .map((a) => ({ id: a.id, location: a.coordinates })),
  );

  store.activities = store.activities
    .map((a) =>
      needDrive.has(a.id)
        ? { ...a, driveMinutes: driveTimes[a.id] ?? a.driveMinutes }
        : a,
    )
    .filter(
      (a) => a.driveMinutes != null && a.driveMinutes <= MAX_DRIVE_MINUTES,
    )
    .sort((a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0));

  store.maxDriveMinutes = MAX_DRIVE_MINUTES;
  store.syncedAt = new Date().toISOString();
  await writeStore(store);

  for (const id of movedIds) {
    const row = store.activities.find((a) => a.id === id);
    logResult(id, row);
  }
}

function logResult(id: string, row: Activity | undefined) {
  if (!row) {
    console.log(`${id}: dropped (over ${MAX_DRIVE_MINUTES} min)`);
    return;
  }
  console.log(
    `${row.title}: ${row.driveMinutes} min · ${row.rawFacts.coordSource} · ${row.coordinates.lat},${row.coordinates.lng}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
