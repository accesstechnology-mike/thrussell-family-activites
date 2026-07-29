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
  const beachR = Math.min(Math.max(r, 95000), 110000);
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
    // Named coastal beaches — wider radius so Yorkshire / Teesside coast is in range.
    `
[out:json][timeout:45];
(
  node["natural"="beach"]["name"](around:${beachR},${lat},${lng});
  way["natural"="beach"]["name"](around:${beachR},${lat},${lng});
  relation["natural"="beach"]["name"](around:${beachR},${lat},${lng});
  node["leisure"="beach_resort"]["name"](around:${beachR},${lat},${lng});
  way["leisure"="beach_resort"]["name"](around:${beachR},${lat},${lng});
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
  const needsBeachFallback = !elements.some(
    (el) =>
      el.tags?.natural === "beach" || el.tags?.leisure === "beach_resort",
  );
  if (
    needsZooFallback ||
    needsPoolFallback ||
    needsLeisureFallback ||
    needsResortFallback ||
    needsBeachFallback
  ) {
    const nominatimExtras = await nominatimNearbyAttractions(origin, {
      zoos: needsZooFallback,
      swimming: needsPoolFallback || needsLeisureFallback || needsResortFallback,
      beaches: needsBeachFallback,
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

    const kind = tags.tourism || tags.leisure || tags.natural || "attraction";
    if (isPrivateNonPublicPool(tags, kind, name)) continue;
    if (isUnsuitableBeach(tags, kind, name)) continue;

    const latLng = el.lat ?? el.center?.lat;
    const lngLng = el.lon ?? el.center?.lon;
    if (latLng == null || lngLng == null) continue;
    if (
      (kind === "beach" || kind === "beach_resort") &&
      !isLikelyCoastalOrLakesideBeach(latLng, lngLng, name)
    ) {
      continue;
    }

    const kidHint =
      /zoo|farm|castle|abbey|railway|steam|bird|prey|falcon|park|beach|sands|bay|aquarium|theme|swim|pool|leisure|wellbeing|wellness|resort|water.?park|laugher/i.test(
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
              : kind === "beach" || kind === "beach_resort"
                ? beachSummary(tags)
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
              : kind === "beach" || kind === "beach_resort"
                ? "Free coastal beach"
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
    if (
      (kind === "beach" || kind === "beach_resort" || /\bbeach\b|\bsands\b/i.test(name)) &&
      !features.includes("beach")
    ) {
      features.push("beach");
    }

    const terrainInfo = inferTerrain(
      kind === "beach" || kind === "beach_resort" ? "flat" : null,
      ownText,
    );
    const isBeach = kind === "beach" || kind === "beach_resort";
    const cost =
      tags.fee === "yes"
        ? tags["fee:conditional"]
          ? `Admission charged (${tags["fee:conditional"]})`
          : "Admission charged — see website"
        : tags.fee === "no" || isBeach
          ? "Free entry"
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
      isFree:
        tags.fee === "yes" ? false : tags.fee === "no" || isBeach ? true : null,
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
  // Two passes — Overpass often 504s on the first hit when busy.
  for (let pass = 0; pass < 2; pass++) {
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
          await sleep(500 + pass * 800);
          continue;
        }
        if (text.trimStart().startsWith("<")) {
          lastError = `${endpoint} → HTML error body`;
          await sleep(500 + pass * 800);
          continue;
        }
        const data = JSON.parse(text) as { elements?: OverpassElement[] };
        const elements = data.elements ?? [];
        // Empty payloads are often overloaded mirrors; prefer another endpoint.
        if (!elements.length) {
          lastError = `${endpoint} → empty`;
          await sleep(500 + pass * 800);
          continue;
        }
        return elements;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await sleep(400);
      }
    }
  }
  console.warn(`Overpass query failed (${lastError})`);
  return [];
}

/** Nominatim fallback when Overpass is unavailable. */
async function nominatimNearbyAttractions(
  origin: LatLng,
  opts: { zoos: boolean; swimming: boolean; beaches?: boolean },
): Promise<OverpassElement[]> {
  const placeHint = await reverseTownName(origin);
  const near = placeHint ? `near ${placeHint}` : "Yorkshire";
  const queries: Array<{ q: string; viewbox: string; limit: string }> = [];
  const inlandBox = [
    origin.lng - 0.9,
    origin.lat + 0.55,
    origin.lng + 0.9,
    origin.lat - 0.55,
  ].join(",");
  // Stretch east so Yorkshire / Teesside beaches stay inside the search window.
  const coastBox = [
    origin.lng - 0.7,
    origin.lat + 0.75,
    origin.lng + 1.5,
    origin.lat - 0.55,
  ].join(",");

  if (opts.zoos) {
    for (const q of [
      `zoo ${near}`,
      `birds of prey ${near}`,
      `petting zoo ${near}`,
      `theme park ${near}`,
    ]) {
      queries.push({ q, viewbox: inlandBox, limit: "10" });
    }
  }
  if (opts.swimming) {
    for (const q of [
      `swimming pool ${near}`,
      `leisure centre ${near}`,
      `leisure centre Ripon`,
      `lakes ${near}`,
      `holiday park ${near}`,
    ]) {
      queries.push({ q, viewbox: inlandBox, limit: "10" });
    }
  }
  if (opts.beaches) {
    for (const q of [
      `beach ${near}`,
      `beach Filey`,
      `beach Scarborough`,
      `beach Whitby`,
      `beach Saltburn`,
      `beach Hornsea`,
      `sands Yorkshire`,
    ]) {
      queries.push({ q, viewbox: coastBox, limit: "20" });
    }
  }
  const out: OverpassElement[] = [];
  const seen = new Set<string>();

  for (const item of queries) {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        format: "json",
        limit: item.limit,
        countrycodes: "gb",
        q: item.q,
        viewbox: item.viewbox,
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
        // Beach discovery must be actual beaches, not cafes/roads with "beach" in the name.
        if (item.q.startsWith("beach") || item.q.startsWith("sands")) {
          if (row.type !== "beach") continue;
        }
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
    type === "nature_reserve" ||
    type === "beach_resort"
  ) {
    return { ...base, leisure: type };
  }
  if (type === "beach" || (klass === "natural" && type === "beach")) {
    return { ...base, natural: "beach" };
  }
  if (klass === "leisure" && type) {
    return { ...base, leisure: type };
  }
  if (klass === "natural" && type) {
    return { ...base, natural: type };
  }
  if (/swim|pool|leisure|wellbeing|wellness|laugher/i.test(name)) {
    return { ...base, leisure: "sports_centre" };
  }
  if (/lakes?|resort|lodge/i.test(name) && /woodland|holiday|park/i.test(name)) {
    return { ...base, leisure: "resort" };
  }
  if (/\bbeach\b|\bsands\b|\bbay\b/i.test(name)) {
    return { ...base, natural: "beach" };
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

/** Drop nude, private, industrial, or too-generic beach fragments. */
function isUnsuitableBeach(
  tags: Record<string, string>,
  kind: string,
  name: string,
): boolean {
  if (kind !== "beach" && kind !== "beach_resort") return false;
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
  // Nominatim sometimes returns cafes, huts, lifts, and roads for "beach" queries.
  if (
    /beach\s*(cafe|café|hut|huts|chalet|chalets|road|car\s*park)|^(lift to|access to)\b/i.test(
      name,
    )
  ) {
    return true;
  }
  return false;
}

function beachSummary(tags: Record<string, string>): string {
  const surface = (tags.surface || "").toLowerCase();
  if (/sand/.test(surface)) return "Sandy beach for a family day out";
  if (/pebble|shingle|stone/.test(surface)) {
    return "Pebbly beach — rockpooling and coastal exploring";
  }
  if (/rock/.test(surface)) return "Rocky beach — coastal exploring";
  return "Coastal beach for a family day out";
}

/** Keep North Sea coast + lakeside beaches; drop Vale of York sandpits etc. */
function isLikelyCoastalOrLakesideBeach(
  lat: number,
  lng: number,
  name: string,
): boolean {
  if (/lakeside/i.test(name)) return true;
  if (lat >= 53.85 && lat <= 54.35 && lng < -0.85) return false;
  if (lng > -1.55 && lat > 54.45 && lat < 55.15) return true;
  if (lng > -1.2 && lat > 53.45 && lat < 54.55) return true;
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
  if (tourism === "beach" || tourism === "beach_resort") return "Beach";
  return "Attraction";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
