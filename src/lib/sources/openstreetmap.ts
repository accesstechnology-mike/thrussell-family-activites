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

  // Nominatim fallback for zoos if Overpass was empty/throttled.
  if (!elements.some((el) => el.tags?.tourism === "zoo")) {
    const nominatimZoos = await nominatimNearbyZoos(origin);
    for (const el of nominatimZoos) {
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
      /^(toilets|car park|parking|picnic|bench|memorial|monument|artwork|information)$/i.test(
        name,
      )
    ) {
      continue;
    }

    const kind = tags.tourism || tags.leisure || "attraction";
    const kidHint =
      /zoo|farm|castle|abbey|railway|steam|bird|prey|falcon|park|beach|aquarium|theme/i.test(
        `${name} ${kind} ${tags.zoo || ""} ${tags.attraction || ""}`,
      );
    if (kind === "museum" && !kidHint) continue;
    if (kind === "attraction" && !kidHint && !tags.website) continue;

    const latLng = el.lat ?? el.center?.lat;
    const lngLng = el.lon ?? el.center?.lon;
    if (latLng == null || lngLng == null) continue;

    const website =
      tags.website ||
      tags["contact:website"] ||
      `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const postcode = tags["addr:postcode"] || null;
    const description =
      tags.description ||
      tags["description:en"] ||
      [
        familyLabel(kind, tags),
        tags.opening_hours ? `Hours: ${tags.opening_hours}` : null,
        tags.fee === "yes"
          ? "Admission charged (see website)"
          : tags.fee === "no"
            ? "Free entry"
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
    ].join("\n");
    const features = extractFeatures(name, ownText);
    if (/\b(bird|prey|falcon|owl|eagle|zoo|farm|animal)/i.test(ownText)) {
      if (!features.includes("animals")) features.push("animals");
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
async function nominatimNearbyZoos(origin: LatLng): Promise<OverpassElement[]> {
  const placeHint = await reverseTownName(origin);
  const near = placeHint ? `near ${placeHint}` : "Yorkshire";
  const queries = [
    `zoo ${near}`,
    `birds of prey ${near}`,
    `petting zoo ${near}`,
    `theme park ${near}`,
  ];
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
        const tourism =
          row.type === "zoo" || row.type === "theme_park" || row.type === "aquarium"
            ? row.type
            : "attraction";
        out.push({
          type,
          id: row.osm_id,
          lat: Number(row.lat),
          lon: Number(row.lon),
          tags: {
            name,
            tourism,
            ...(row.extratags || {}),
          },
        });
      }
    } catch {
      // ignore
    }
  }
  return out;
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
  return "Attraction";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
