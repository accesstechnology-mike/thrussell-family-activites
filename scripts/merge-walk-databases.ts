/**
 * Union-merge Walkiees + similar walk databases into the existing store.
 * Avoids a full re-sync (which re-fetches every source and re-caches images).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DRIVE_MINUTES } from "../src/lib/config";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import { withFreeFlag } from "../src/lib/free";
import { enrichActivityImages } from "../src/lib/images";
import { getOrigin } from "../src/lib/origin";
import { fetchDogFriendly } from "../src/lib/sources/dog-friendly";
import { fetchOutdoorGuide } from "../src/lib/sources/outdoor-guide";
import { fetchWalkiees } from "../src/lib/sources/walkiees";
import { fetchWhere2walk } from "../src/lib/sources/where2walk";
import type { Activity, ActivitySource, ActivityStore } from "../src/lib/types";

const NEW_SOURCES: ActivitySource[] = [
  "walkiees",
  "outdoor-guide",
  "dog-friendly",
  "where2walk",
];

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;
  const origin = await getOrigin();

  console.log("Fetching Walkiees…");
  const walkiees = await fetchWalkiees();
  console.log(`Walkiees ${walkiees.length}`);

  console.log("Fetching The Outdoor Guide…");
  const outdoor = await fetchOutdoorGuide();
  console.log(`Outdoor Guide ${outdoor.length}`);

  console.log("Fetching DogFriendly…");
  const dogFriendly = await fetchDogFriendly(origin.location);
  console.log(`DogFriendly ${dogFriendly.length}`);

  console.log("Fetching Where2walk…");
  const where2walk = await fetchWhere2walk();
  console.log(`Where2walk ${where2walk.length}`);

  const incoming = [...walkiees, ...outdoor, ...dogFriendly, ...where2walk];
  const byId = new Map(store.activities.map((a) => [a.id, a]));

  let added = 0;
  let updated = 0;
  for (const fresh of incoming) {
    const prev = byId.get(fresh.id);
    if (!prev) {
      byId.set(fresh.id, fresh);
      added += 1;
      console.log(" +", fresh.source, fresh.title);
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
    (a) =>
      NEW_SOURCES.includes(a.source) &&
      (!a.imageUrl || !a.imageUrl.startsWith("/media/")),
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

  const fetchedBySource: Record<string, Activity[]> = {
    walkiees,
    "outdoor-guide": outdoor,
    "dog-friendly": dogFriendly,
    where2walk,
  };
  for (const source of NEW_SOURCES) {
    const fetched = fetchedBySource[source] ?? [];
    const existing = store.sourceStatuses.find((s) => s.source === source);
    const status = {
      source,
      ok: true,
      fetched: fetched.length,
      kept: store.activities.filter((a) => a.source === source).length,
      error: null,
      finishedAt: store.syncedAt,
    };
    if (existing) Object.assign(existing, status);
    else store.sourceStatuses.push(status);
  }

  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const keptNew = store.activities.filter((a) => NEW_SOURCES.includes(a.source));
  console.log(
    `Store ${store.activities.length}; new-source kept ${keptNew.length}`,
  );
  const ripley = store.activities.filter((a) => /ripley/i.test(a.title));
  for (const a of ripley) {
    console.log(
      `${a.driveMinutes} min · ${a.title} · ${a.source} · ${a.sourceUrl}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
