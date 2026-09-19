/**
 * Re-pin place-name activities whose stored coordinates sit near home
 * but Nominatim now resolves the title much farther away (homonym bug).
 * Drive minutes are refreshed via the same OSRM table API as sync.
 */
import { MAX_DRIVE_MINUTES } from "../src/lib/config";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import { geocodePlaceName } from "../src/lib/geocode";
import { getOrigin } from "../src/lib/origin";
import { haversineKm } from "../src/lib/sources/listicle";
import { readStore, writeStore } from "../src/lib/store";
import type { ActivitySource } from "../src/lib/types";

const PLACE_NAME_SOURCES = new Set<ActivitySource>([
  "where2walk",
  "outdoor-guide",
  "muddy-boots-mummy",
  "alltrails",
  "yorkshire-tots",
  "little-vikings",
  "teesside-family-life",
  "dog-friendly",
]);

const NEAR_HOME_KM = 20;
const MOVED_KM = 15;

async function main() {
  const store = await readStore();
  const origin = await getOrigin();
  store.origin = origin.location;
  store.originPostcode = origin.postcode;

  const suspects = store.activities.filter(
    (a) =>
      !a.postcode &&
      PLACE_NAME_SOURCES.has(a.source) &&
      haversineKm(origin.location, a.coordinates) < NEAR_HOME_KM,
  );
  console.log(
    `Checking ${suspects.length} near-home place-name pins against Nominatim…`,
  );

  const movedIds: string[] = [];
  for (const activity of suspects) {
    const place = await geocodePlaceName(`${activity.title}, UK`, {
      near: origin.location,
    });
    if (!place) {
      console.log(`  miss: ${activity.title}`);
      continue;
    }
    const moved = haversineKm(activity.coordinates, place);
    if (moved < MOVED_KM) {
      console.log(`  keep ${moved.toFixed(1)}km: ${activity.title}`);
      continue;
    }
    console.log(
      `  moved ${moved.toFixed(1)}km: ${activity.title} → ${place.lat},${place.lng}`,
    );
    activity.coordinates = { lat: place.lat, lng: place.lng };
    if (place.postcode) activity.postcode = place.postcode;
    movedIds.push(activity.id);
  }

  if (!movedIds.length) {
    console.log("No homonym pins to update.");
    return;
  }

  const driveTimes = await getDriveTimesMinutes(
    origin.location,
    store.activities
      .filter((a) => movedIds.includes(a.id))
      .map((a) => ({ id: a.id, location: a.coordinates })),
  );

  store.activities = store.activities
    .map((a) =>
      movedIds.includes(a.id)
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
    if (!row) {
      console.log(`${id}: dropped (over ${MAX_DRIVE_MINUTES} min)`);
      continue;
    }
    console.log(
      `${row.title}: ${row.driveMinutes} min · ${row.coordinates.lat},${row.coordinates.lng}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
