import { USER_AGENT } from "../config";
import {
  extractFeatures,
  inferTerrain,
  slugId,
} from "../features";
import type { Activity, LatLng } from "../types";

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/**
 * Family-relevant attractions from OpenStreetMap near home.
 * Fills gaps walk listicles miss (e.g. Thirsk Birds of Prey Centre).
 */
export async function fetchOpenStreetMapAttractions(
  origin: LatLng,
  radiusMeters = 70000,
): Promise<Activity[]> {
  const query = `
[out:json][timeout:45];
(
  node["tourism"~"^(zoo|attraction|theme_park|aquarium|museum)$"](around:${radiusMeters},${origin.lat},${origin.lng});
  way["tourism"~"^(zoo|attraction|theme_park|aquarium|museum)$"](around:${radiusMeters},${origin.lat},${origin.lng});
  relation["tourism"~"^(zoo|attraction|theme_park|aquarium|museum)$"](around:${radiusMeters},${origin.lat},${origin.lng});
  node["leisure"="nature_reserve"]["name"](around:${radiusMeters},${origin.lat},${origin.lng});
  way["leisure"="nature_reserve"]["name"](around:${radiusMeters},${origin.lat},${origin.lng});
);
out center tags;
`.trim();

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`OpenStreetMap Overpass failed (${res.status})`);
  }

  const data = (await res.json()) as { elements?: OverpassElement[] };
  const now = new Date().toISOString();
  const activities: Activity[] = [];

  for (const el of data.elements ?? []) {
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
    // Skip sparse / non-family noise unless it looks kid-relevant.
    const tourism = tags.tourism || tags.leisure || "";
    const kidHint =
      /zoo|farm|castle|abbey|railway|steam|bird|prey|falcon|park|beach|aquarium|theme/i.test(
        `${name} ${tourism} ${tags.zoo || ""} ${tags.attraction || ""}`,
      );
    if (tourism === "museum" && !kidHint) continue;
    if (tourism === "attraction" && !kidHint && !tags.website) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const kind = tags.tourism || tags.leisure || "attraction";
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

    const ownText = [name, description, kind, tags.zoo || "", tags.attraction || ""].join(
      "\n",
    );
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
      coordinates: { lat, lng },
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

function familyLabel(
  tourism: string,
  tags: Record<string, string>,
): string {
  if (tags.zoo === "petting_zoo") return "Petting farm";
  if (tourism === "zoo") return "Zoo / wildlife";
  if (tourism === "theme_park") return "Theme park";
  if (tourism === "aquarium") return "Aquarium";
  if (tourism === "museum") return "Museum";
  if (tourism === "nature_reserve") return "Nature reserve";
  return "Attraction";
}
