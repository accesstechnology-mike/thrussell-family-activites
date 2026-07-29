import { USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import type { Activity, LatLng } from "../types";

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Family-relevant attractions from OpenStreetMap near home.
 * Fills gaps walk listicles miss (e.g. Thirsk Birds of Prey Centre).
 */
export async function fetchOpenStreetMapAttractions(
  origin: LatLng,
  radiusMeters = 85000,
): Promise<Activity[]> {
  const r = radiusMeters;
  const lat = origin.lat;
  const lng = origin.lng;

  // Prefer small typed queries — large combined requests often 504.
  const swimR = Math.min(r, 45000);
  const queries = [
    `
[out:json][timeout:40];
(
  node["tourism"="zoo"](around:${r},${lat},${lng});
  way["tourism"="zoo"](around:${r},${lat},${lng});
  relation["tourism"="zoo"](around:${r},${lat},${lng});
  node["tourism"="theme_park"](around:${r},${lat},${lng});
  way["tourism"="theme_park"](around:${r},${lat},${lng});
  node["tourism"="aquarium"](around:${r},${lat},${lng});
  way["tourism"="aquarium"](around:${r},${lat},${lng});
);
out center tags;
`.trim(),
    `
[out:json][timeout:40];
(
  node["tourism"="attraction"]["name"](around:${Math.min(r, 40000)},${lat},${lng});
  way["tourism"="attraction"]["name"](around:${Math.min(r, 40000)},${lat},${lng});
);
out center tags;
`.trim(),
    `
[out:json][timeout:40];
(
  node["leisure"="nature_reserve"]["name"](around:${Math.min(r, 35000)},${lat},${lng});
  way["leisure"="nature_reserve"]["name"](around:${Math.min(r, 35000)},${lat},${lng});
);
out center tags;
`.trim(),
    // Keep swim/leisure queries small — large unions often 504 and drop everything.
    `
[out:json][timeout:40];
(
  node["leisure"="swimming_pool"]["name"](around:${swimR},${lat},${lng});
  way["leisure"="swimming_pool"]["name"](around:${swimR},${lat},${lng});
  node["leisure"="water_park"]["name"](around:${swimR},${lat},${lng});
  way["leisure"="water_park"]["name"](around:${swimR},${lat},${lng});
);
out center tags;
`.trim(),
    `
[out:json][timeout:40];
(
  node["leisure"="sports_centre"]["name"~"Leisure|Swim|Pool|Wellbeing|Wellness|Laugher",i](around:${swimR},${lat},${lng});
  way["leisure"="sports_centre"]["name"~"Leisure|Swim|Pool|Wellbeing|Wellness|Laugher",i](around:${swimR},${lat},${lng});
);
out center tags;
`.trim(),
    `
[out:json][timeout:40];
(
  node["leisure"="resort"]["name"](around:${Math.min(r, 35000)},${lat},${lng});
  way["leisure"="resort"]["name"](around:${Math.min(r, 35000)},${lat},${lng});
);
out center tags;
`.trim(),
  ];

  const elements: OverpassElement[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const batch = await overpassQuery(query);
    for (const el of batch) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push(el);
    }
    await sleep(700);
  }

  // Nominatim fallback when Overpass is empty/throttled for key families.
  const needsZooFallback = !elements.some((el) => el.tags?.tourism === "zoo");
  const needsPoolFallback = !elements.some(
    (el) => el.tags?.leisure === "swimming_pool",
  );
  const needsLeisureFallback = !elements.some((el) =>
    /^(sports_centre|water_park)$/i.test(el.tags?.leisure || ""),
  );
  const needsResortFallback = !elements.some(
    (el) => el.tags?.leisure === "resort",
  );
  if (
    needsZooFallback ||
    needsPoolFallback ||
    needsLeisureFallback ||
    needsResortFallback
  ) {
    const nominatimExtras = await nominatimNearbyAttractions(origin, {
      zoos: needsZooFallback,
      swimming: needsPoolFallback || needsLeisureFallback || needsResortFallback,
    });
    for (const el of nominatimExtras) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push(el);
    }
  }

  const now = new Date().toISOString();
  const activities: Activity[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name || name.length < 3) continue;
    if (
      /^(toilets|car park|parking|picnic|bench|memorial|monument|artwork|information|swimming pool|paddling pool|lido)$/i.test(
        name,
      )
    ) {
      continue;
    }

    const kind = tags.tourism || tags.leisure || "attraction";
    if (isPrivateNonPublicPool(tags, kind, name)) continue;

    const kidHint =
      /zoo|farm|castle|abbey|railway|steam|bird|prey|falcon|park|beach|aquarium|theme|swim|pool|leisure|wellbeing|wellness|resort|water.?park|laugher/i.test(
        `${name} ${kind} ${tags.zoo || ""} ${tags.attraction || ""}`,
      );
    if (kind === "museum" && !kidHint) continue;
    if (kind === "attraction" && !kidHint && !tags.website) continue;
    // Skip generic gyms / unnamed hotel-style pools.
    if (
      kind === "sports_centre" &&
      !/leisure|swim|pool|wellbeing|wellness|laugher/i.test(name)
    ) {
      continue;
    }

    const latLng = el.lat ?? el.center?.lat;
    const lngLng = el.lon ?? el.center?.lon;
    if (latLng == null || lngLng == null) continue;

    const rawWebsite = tags.website || tags["contact:website"] || "";
    const website = rawWebsite
      ? /^https?:\/\//i.test(rawWebsite)
        ? rawWebsite
        : `https://${rawWebsite.replace(/^\/\//, "")}`
      : `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const postcode = tags["addr:postcode"] || null;
    const description =
      tags.description ||
      tags["description:en"] ||
      [
        familyLabel(kind, tags),
        kind === "swimming_pool" || kind === "water_park"
          ? "Family swimming"
          : kind === "sports_centre" && /leisure|swim|pool|wellbeing|wellness/i.test(name)
            ? "Public leisure centre with swimming"
            : kind === "resort" && /\blakes?\b/i.test(name)
              ? "Holiday park with lakeside swimming and family activities"
              : null,
        tags.operator ? `Operator: ${tags.operator}` : null,
        tags.opening_hours ? `Hours: ${tags.opening_hours}` : null,
        tags.fee === "yes"
          ? "Admission charged (see website)"
          : tags.fee === "no"
            ? "Free entry"
            : kind === "swimming_pool" ||
                kind === "sports_centre" ||
                kind === "water_park" ||
                kind === "resort"
              ? "Admission charged — see venue"
              : null,
      ]
        .filter(Boolean)
        .join(". ");

    const ownText = [
      name,
      description,
      kind,
      tags.zoo || "",
      tags.attraction || "",
      tags.sport || "",
    ].join("\n");
    const features = extractFeatures(name, ownText);
    if (/\b(bird|prey|falcon|owl|eagle|zoo|farm|animal)/i.test(ownText)) {
      if (!features.includes("animals")) features.push("animals");
    }
    if (
      (/swim|pool|water.?park|paddle|sauna/i.test(ownText) ||
        (kind === "resort" && /\blakes?\b/i.test(name))) &&
      !features.includes("swimming")
    ) {
      features.push("swimming");
    }

    const terrainInfo = inferTerrain(null, ownText);
    const cost =
      tags.fee === "no"
        ? "Free entry"
        : tags.fee === "yes"
          ? tags["fee:conditional"]
            ? `Admission charged (${tags["fee:conditional"]})`
            : "Admission charged — see website"
          : null;

    activities.push({
      id: slugId("openstreetmap", name, `${el.type}-${el.id}`),
      source: "openstreetmap",
      sourceUrl: website,
      title: name,
      summary: description || `Family outing near home: ${name}`,
      imageUrl: null,
      imageAlt: name,
      locationLabel: tags["addr:city"] || tags["addr:hamlet"] || null,
      postcode,
      what3words: null,
      coordinates: { lat: latLng, lng: lngLng },
      parking: tags.parking || null,
      cost,
      distanceMiles: null,
      terrain: terrainInfo.terrain,
      terrainNotes: terrainInfo.notes,
      features,
      categories: ["OpenStreetMap", familyLabel(kind, tags)],
      driveMinutes: null,
      lastSyncedAt: now,
      isFree: tags.fee === "no" ? true : tags.fee === "yes" ? false : null,
      rawFacts: {
        osmType: el.type,
        osmId: String(el.id),
        tourism: kind,
        ...(tags.fee ? { fee: tags.fee } : {}),
        ...(tags.opening_hours ? { openingHours: tags.opening_hours } : {}),
        ...(tags.phone || tags["contact:phone"]
          ? { phone: tags.phone || tags["contact:phone"]! }
          : {}),
      },
    });
  }

  return activities;
}

async function overpassQuery(query: string): Promise<OverpassElement[]> {
  let lastError = "unknown";
  for (const endpoint of OVERPASS_ENDPOINTS) {
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
      if (!res.ok) {
        lastError = `${endpoint} → ${res.status}`;
        continue;
      }
      if (text.trimStart().startsWith("<")) {
        lastError = `${endpoint} → HTML error body`;
        continue;
      }
      const data = JSON.parse(text) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn(`Overpass query failed (${lastError})`);
  return [];
}

/** Nominatim fallback when Overpass is unavailable. */
async function nominatimNearbyAttractions(
  origin: LatLng,
  opts: { zoos: boolean; swimming: boolean },
): Promise<OverpassElement[]> {
  const placeHint = await reverseTownName(origin);
  const near = placeHint ? `near ${placeHint}` : "Yorkshire";
  const queries: string[] = [];
  if (opts.zoos) {
    queries.push(
      `zoo ${near}`,
      `birds of prey ${near}`,
      `petting zoo ${near}`,
      `theme park ${near}`,
    );
  }
  if (opts.swimming) {
    queries.push(
      `swimming pool ${near}`,
      `leisure centre ${near}`,
      `leisure centre Ripon`,
      `lakes ${near}`,
      `holiday park ${near}`,
    );
  }
  const out: OverpassElement[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        format: "json",
        limit: "10",
        countrycodes: "gb",
        q,
        viewbox: [
          origin.lng - 0.9,
          origin.lat + 0.55,
          origin.lng + 0.9,
          origin.lat - 0.55,
        ].join(","),
        bounded: "1",
        extratags: "1",
        namedetails: "0",
      });
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      await sleep(1100);
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{
        osm_type?: string;
        osm_id?: number;
        lat?: string;
        lon?: string;
        name?: string;
        display_name?: string;
        type?: string;
        class?: string;
        extratags?: Record<string, string>;
      }>;
      for (const row of rows) {
        if (!row.osm_id || !row.lat || !row.lon) continue;
        const type =
          row.osm_type === "relation"
            ? "relation"
            : row.osm_type === "way"
              ? "way"
              : "node";
        const key = `${type}/${row.osm_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const name =
          row.name || row.display_name?.split(",")[0]?.trim() || "Attraction";
        const tags = nominatimTagsForRow(row.type, row.class, name, row.extratags);
        out.push({
          type,
          id: row.osm_id,
          lat: Number(row.lat),
          lon: Number(row.lon),
          tags,
        });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function nominatimTagsForRow(
  type: string | undefined,
  klass: string | undefined,
  name: string,
  extratags?: Record<string, string>,
): Record<string, string> {
  const base = { name, ...(extratags || {}) };
  if (type === "zoo" || type === "theme_park" || type === "aquarium") {
    return { ...base, tourism: type };
  }
  if (
    type === "swimming_pool" ||
    type === "sports_centre" ||
    type === "water_park" ||
    type === "resort" ||
    type === "nature_reserve"
  ) {
    return { ...base, leisure: type };
  }
  if (klass === "leisure" && type) {
    return { ...base, leisure: type };
  }
  if (/swim|pool|leisure|wellbeing|wellness|laugher/i.test(name)) {
    return { ...base, leisure: "sports_centre" };
  }
  if (/lakes?|resort|lodge/i.test(name) && /woodland|holiday|park/i.test(name)) {
    return { ...base, leisure: "resort" };
  }
  return { ...base, tourism: "attraction" };
}

function isPrivateNonPublicPool(
  tags: Record<string, string>,
  kind: string,
  name: string,
): boolean {
  if (!/swimming_pool|sports_centre|water_park|resort/i.test(kind)) return false;
  const access = (tags.access || "").toLowerCase();
  if (access === "private" || access === "no") return true;
  // Hotel / house pools that aren't public leisure venues.
  if (
    kind === "swimming_pool" &&
    /hotel|inn|bnb|b&b|guest house|holiday cottage/i.test(name) &&
    access !== "yes" &&
    access !== "public"
  ) {
    return true;
  }
  return false;
}

async function reverseTownName(origin: LatLng): Promise<string | null> {
  const url =
    "https://nominatim.openstreetmap.org/reverse?" +
    new URLSearchParams({
      format: "json",
      lat: String(origin.lat),
      lon: String(origin.lng),
      zoom: "12",
    });
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    await sleep(1100);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        town?: string;
        city?: string;
        village?: string;
        municipality?: string;
        county?: string;
      };
    };
    return (
      data.address?.town ||
      data.address?.city ||
      data.address?.village ||
      data.address?.municipality ||
      data.address?.county ||
      null
    );
  } catch {
    return null;
  }
}

function familyLabel(tourism: string, tags: Record<string, string>): string {
  if (tags.zoo === "petting_zoo") return "Petting farm";
  if (tourism === "zoo") return "Zoo / wildlife";
  if (tourism === "theme_park") return "Theme park";
  if (tourism === "aquarium") return "Aquarium";
  if (tourism === "museum") return "Museum";
  if (tourism === "nature_reserve") return "Nature reserve";
  if (tourism === "swimming_pool") return "Swimming";
  if (tourism === "water_park") return "Water park";
  if (tourism === "sports_centre") return "Leisure centre";
  if (tourism === "resort") return "Holiday park / resort";
  return "Attraction";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
