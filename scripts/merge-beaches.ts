/**
 * Dedicated beach pull via Overpass (isolated query is more reliable),
 * then union-merge into the existing store.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DRIVE_MINUTES, USER_AGENT } from "../src/lib/config";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import { extractFeatures, inferTerrain, slugId } from "../src/lib/features";
import { withFreeFlag } from "../src/lib/free";
import { enrichActivityImages } from "../src/lib/images";
import { getOrigin } from "../src/lib/origin";
import type { Activity, ActivityStore } from "../src/lib/types";

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function unsuitable(name: string, tags: Record<string, string>): boolean {
  const access = (tags.access || "").toLowerCase();
  if (access === "private" || access === "no") return true;
  const nudism = (tags.nudism || "").toLowerCase();
  if (nudism && nudism !== "no") return true;
  if (/chemical|blast beach|sewage|nude|naturist|dogging/i.test(name)) {
    return true;
  }
  if (
    /^(the beach|car park beach|shingles|stone beach|shingle beach|pebble beach|sea lions|wader point|sands)$/i.test(
      name.trim(),
    )
  ) {
    return true;
  }
  if (/creek\s+beach/i.test(name)) return true;
  if (
    /beach\s*(cafe|café|hut|huts|chalet|chalets|road|car\s*park)|^(lift to|access to)\b/i.test(
      name,
    )
  ) {
    return true;
  }
  return false;
}

/** Keep North Sea coast + known inland lakeside beaches; drop Vale of York sandpits etc. */
function isLikelyCoastalOrLakesideBeach(
  lat: number,
  lng: number,
  name: string,
): boolean {
  if (/lakeside/i.test(name)) return true;
  // Vale of York / inland belt between the Dales and the coast.
  if (lat >= 53.85 && lat <= 54.35 && lng < -0.85) return false;
  // Teesside / Durham / Tyneside coast
  if (lng > -1.55 && lat > 54.45 && lat < 55.15) return true;
  // Yorkshire / Holderness / Filey–Bridlington coast
  if (lng > -1.2 && lat > 53.45 && lat < 54.55) return true;
  return false;
}

function beachBlurb(tags: Record<string, string>): string {
  const surface = (tags.surface || "").toLowerCase();
  if (/sand/.test(surface)) return "Sandy beach for a family day out";
  if (/pebble|shingle|stone/.test(surface)) {
    return "Pebbly beach — rockpooling and coastal exploring";
  }
  if (/rock/.test(surface)) return "Rocky beach — coastal exploring";
  return "Coastal beach for a family day out";
}

async function fetchBeaches(
  lat: number,
  lng: number,
): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:50];
(
  node["natural"="beach"]["name"](around:100000,${lat},${lng});
  way["natural"="beach"]["name"](around:100000,${lat},${lng});
  relation["natural"="beach"]["name"](around:100000,${lat},${lng});
  node["leisure"="beach_resort"]["name"](around:100000,${lat},${lng});
  way["leisure"="beach_resort"]["name"](around:100000,${lat},${lng});
);
out center tags;`;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await res.text();
      if (!res.ok || text.trimStart().startsWith("<")) {
        console.warn(
          `${endpoint} → ${res.status} ${text.trimStart().startsWith("<") ? "HTML" : ""}`.trim(),
        );
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      const data = JSON.parse(text) as { elements?: OverpassElement[] };
      const elements = data.elements ?? [];
      console.log(`${endpoint} → ${elements.length} elements`);
      // Empty success is often a busy/partial Overpass answer — try the next mirror.
      if (!elements.length) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return elements;
    } catch (err) {
      console.warn(endpoint, err);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return [];
}

function toActivity(el: OverpassElement, now: string): Activity | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name || name.length < 3) return null;
  if (unsuitable(name, tags)) return null;
  const latLng = el.lat ?? el.center?.lat;
  const lngLng = el.lon ?? el.center?.lon;
  if (latLng == null || lngLng == null) return null;
  if (!isLikelyCoastalOrLakesideBeach(latLng, lngLng, name)) return null;

  const kind = tags.leisure === "beach_resort" ? "beach_resort" : "beach";
  const ownText = [name, kind, tags.surface || "", beachBlurb(tags)].join("\n");
  const features = extractFeatures(name, ownText);
  if (!features.includes("beach")) features.push("beach");
  const terrainInfo = inferTerrain("flat", ownText);
  const paid = tags.fee === "yes";

  return {
    id: slugId("openstreetmap", name, `${el.type}-${el.id}`),
    source: "openstreetmap",
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    title: name,
    summary: `Beach. ${beachBlurb(tags)}. ${paid ? "Admission charged — see venue" : "Free coastal beach"}`,
    imageUrl: null,
    imageAlt: name,
    locationLabel: tags["addr:city"] || tags["addr:hamlet"] || null,
    postcode: tags["addr:postcode"] || null,
    what3words: null,
    coordinates: { lat: latLng, lng: lngLng },
    parking: tags.parking || null,
    cost: paid ? "Admission charged — see website" : "Free entry",
    distanceMiles: null,
    terrain: terrainInfo.terrain,
    terrainNotes: terrainInfo.notes,
    features,
    categories: ["OpenStreetMap", "Beach"],
    driveMinutes: null,
    lastSyncedAt: now,
    isFree: paid ? false : true,
    rawFacts: {
      osmType: el.type,
      osmId: String(el.id),
      tourism: kind,
      ...(tags.surface ? { surface: tags.surface } : {}),
      ...(tags.fee ? { fee: tags.fee } : {}),
    },
  };
}

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;
  const origin = await getOrigin();
  const now = new Date().toISOString();

  const fromFile = process.argv.find((a) => a.startsWith("--file="))?.slice(
    "--file=".length,
  );

  console.log("Fetching beaches…");
  let elements: OverpassElement[] = [];
  if (fromFile) {
    const raw = JSON.parse(await readFile(fromFile, "utf8")) as {
      elements?: OverpassElement[];
    };
    elements = raw.elements ?? [];
    console.log(`Loaded ${elements.length} elements from ${fromFile}`);
  } else {
    elements = await fetchBeaches(origin.location.lat, origin.location.lng);
    console.log(`Overpass returned ${elements.length} named beaches`);
  }

  const beaches = elements
    .map((el) => toActivity(el, now))
    .filter((a): a is Activity => Boolean(a));
  console.log(`Suitable beaches: ${beaches.length}`);

  const byId = new Map(store.activities.map((a) => [a.id, a]));
  let added = 0;
  for (const beach of beaches) {
    const prev = byId.get(beach.id);
    if (!prev) {
      byId.set(beach.id, beach);
      added += 1;
      console.log(" +", beach.title);
      continue;
    }
    byId.set(beach.id, {
      ...beach,
      imageUrl: prev.imageUrl?.startsWith("/media/")
        ? prev.imageUrl
        : beach.imageUrl,
      imageAlt: prev.imageAlt ?? beach.imageAlt,
      driveMinutes: prev.driveMinutes,
      rawFacts: { ...beach.rawFacts, ...prev.rawFacts },
    });
  }
  console.log(`Added ${added} new beaches`);

  const combined = [...byId.values()];
  const needDrive = combined.filter((a) => a.driveMinutes == null);
  if (needDrive.length) {
    console.log(`Drive times for ${needDrive.length}…`);
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
      a.categories.includes("Beach") &&
      (!a.imageUrl || !a.imageUrl.startsWith("/media/")),
  );
  console.log(`Enriching images for ${needImages.length} beaches…`);
  const imaged = await enrichActivityImages(needImages);
  const imagedById = new Map(imaged.map((a) => [a.id, a]));
  withinRange = withinRange.map((a) => imagedById.get(a.id) ?? a);

  store.activities = withinRange.sort(
    (a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0),
  );
  store.syncedAt = new Date().toISOString();

  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const kept = store.activities.filter((a) => a.categories.includes("Beach"));
  console.log(`Store ${store.activities.length}; beaches in range: ${kept.length}`);
  for (const a of kept.sort(
    (x, y) => (x.driveMinutes ?? 0) - (y.driveMinutes ?? 0),
  )) {
    console.log(
      `${a.driveMinutes} min · ${a.title} · free=${a.isFree} · ${a.imageUrl ?? "(no image)"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
