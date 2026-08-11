/**
 * Union-merge freshly fetched OSM attractions into the existing store.
 * Keeps prior OSM rows when Overpass is partial; preserves cached images.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DRIVE_MINUTES } from "../src/lib/config";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import { withFreeFlag } from "../src/lib/free";
import { enrichActivityImages } from "../src/lib/images";
import { getOrigin } from "../src/lib/origin";
import { fetchOpenStreetMapAttractions } from "../src/lib/sources/openstreetmap";
import type { ActivityStore } from "../src/lib/types";

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;
  const origin = await getOrigin();

  console.log("Fetching OpenStreetMap attractions…");
  const osm = await fetchOpenStreetMapAttractions(origin.location);
  console.log(`OSM returned ${osm.length}`);

  const byId = new Map(store.activities.map((a) => [a.id, a]));

  let added = 0;
  let updated = 0;
  for (const fresh of osm) {
    const prev = byId.get(fresh.id);
    if (!prev) {
      byId.set(fresh.id, fresh);
      added += 1;
      console.log(" +", fresh.title);
      continue;
    }
    byId.set(fresh.id, {
      ...fresh,
      imageUrl: prev.imageUrl?.startsWith("/media/")
        ? prev.imageUrl
        : fresh.imageUrl,
      imageAlt: prev.imageAlt ?? fresh.imageAlt,
      driveMinutes: prev.driveMinutes,
      rawFacts: { ...fresh.rawFacts, ...prev.rawFacts },
    });
    updated += 1;
  }

  console.log(`Added ${added}, refreshed ${updated}`);

  const combined = [...byId.values()];
  const needDrive = combined.filter((a) => a.driveMinutes == null);
  console.log(`Drive times needed for ${needDrive.length}`);
  if (needDrive.length) {
    const driveTimes = await getDriveTimesMinutes(
      origin.location,
      needDrive.map((a) => ({ id: a.id, location: a.coordinates })),
    );
    for (const a of combined) {
      if (a.driveMinutes == null && driveTimes[a.id] != null) {
        a.driveMinutes = driveTimes[a.id]!;
      }
    }
  }

  let withinRange = combined
    .filter(
      (a) => a.driveMinutes != null && a.driveMinutes <= MAX_DRIVE_MINUTES,
    )
    .map(withFreeFlag);

  const needImages = withinRange.filter(
    (a) => !a.imageUrl || !a.imageUrl.startsWith("/media/"),
  );
  console.log(`Enriching images for ${needImages.length}…`);
  const imaged = await enrichActivityImages(needImages);
  const imagedById = new Map(imaged.map((a) => [a.id, a]));
  withinRange = withinRange.map((a) => imagedById.get(a.id) ?? a);

  store.activities = withinRange.sort(
    (a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0),
  );
  store.syncedAt = new Date().toISOString();
  store.origin = origin.location;
  store.maxDriveMinutes = MAX_DRIVE_MINUTES;

  const osmStatus = store.sourceStatuses.find(
    (s) => s.source === "openstreetmap",
  );
  if (osmStatus) {
    osmStatus.ok = true;
    osmStatus.fetched = Math.max(osmStatus.fetched, osm.length);
    osmStatus.kept = store.activities.filter(
      (a) => a.source === "openstreetmap",
    ).length;
    osmStatus.error = null;
    osmStatus.finishedAt = store.syncedAt;
  }

  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  console.log(`Store now ${store.activities.length}`);
  for (const a of store.activities.filter((x) =>
    /woodland lakes|laugher|thirsk swimming|breezy/i.test(x.title),
  )) {
    console.log(
      `${a.driveMinutes} min · ${a.title} · ${a.imageUrl ?? "(no image)"} · free=${a.isFree}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
