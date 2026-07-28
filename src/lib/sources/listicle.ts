import {
  extractFeatures,
  inferTerrain,
  parseDistanceMiles,
  slugId,
} from "../features";
import {
  extractPostcode,
  geocodePlaceName,
  geocodePostcode,
} from "../geocode";
import type { Activity, ActivitySource } from "../types";

export type ListicleItem = {
  title: string;
  summary: string;
  postcodeHint?: string | null;
  distanceHint?: string | null;
  terrainHint?: string | null;
  imageUrl?: string | null;
};

export async function itemsToActivities(
  items: ListicleItem[],
  opts: {
    source: ActivitySource;
    sourceUrl: string;
    category: string;
    regionSuffix?: string;
  },
): Promise<Activity[]> {
  const now = new Date().toISOString();
  const activities: Activity[] = [];

  for (const item of items) {
    const title = cleanTitle(item.title);
    if (!title || title.length < 3) continue;
    if (isNoiseTitle(title)) continue;

    const ownText = [title, item.summary, item.distanceHint, item.terrainHint]
      .filter(Boolean)
      .join("\n");

    let postcode =
      item.postcodeHint ||
      extractPostcode(item.summary) ||
      extractPostcode(title);
    let coords = postcode ? await geocodePostcode(postcode) : null;
    if (!coords) {
      const query = `${title}, ${opts.regionSuffix ?? "Yorkshire"}, UK`;
      const place = await geocodePlaceName(query);
      if (!place) continue;
      coords = {
        lat: place.lat,
        lng: place.lng,
        postcode: place.postcode ?? postcode ?? "",
      };
      postcode = place.postcode ?? postcode;
    }

    const terrainInfo = inferTerrain(item.terrainHint ?? null, ownText);
    const features = extractFeatures(title, ownText);

    activities.push({
      id: slugId(opts.source, title, opts.sourceUrl),
      source: opts.source,
      sourceUrl: opts.sourceUrl,
      title,
      summary: item.summary || `Family walk: ${title}`,
      imageUrl: item.imageUrl ?? null,
      imageAlt: title,
      locationLabel: opts.regionSuffix ?? null,
      postcode: postcode || coords.postcode || null,
      what3words: null,
      coordinates: { lat: coords.lat, lng: coords.lng },
      parking: extractParking(item.summary),
      cost: extractCost(item.summary),
      distanceMiles:
        parseDistanceMiles(item.distanceHint ?? "") ??
        parseDistanceMiles(ownText),
      terrain: terrainInfo.terrain,
      terrainNotes: terrainInfo.notes,
      features,
      categories: [opts.category],
      driveMinutes: null,
      lastSyncedAt: now,
      rawFacts: {},
    });
  }

  return activities;
}

function cleanTitle(title: string): string {
  return title
    .replace(/^#+\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#\d+\s*-\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseTitle(title: string): boolean {
  return /^(family walks in|elsewhere|top trails|top parks|top cities|more info|good to know|visitor details|recommended|navigate to|these yorkshire|showing results|explore more|frequently asked|activities|attractions|suitability|points of interest)/i.test(
    title,
  );
}

function extractParking(text: string): string | null {
  const m = text.match(/Parking[^.?]{0,160}[.!?]/i);
  return m?.[0]?.trim() ?? null;
}

function extractCost(text: string): string | null {
  const m = text.match(
    /(?:Admission|Entry|Ticket|Free admission|just pay to park|pay to park)[^.?]{0,140}[.!?]/i,
  );
  return m?.[0]?.trim() ?? null;
}

/** Normalise a title for cross-source duplicate detection. */
export function normalisedPlaceKey(title: string): string {
  let t = title.toLowerCase().replace(/&amp;/g, " and ");
  // "Malham Walks: Malham Cove" → prefer the landmark after the colon
  if (t.includes(":")) {
    const after = t.split(":").slice(1).join(" ").trim();
    if (after.length >= 4) t = after;
  }
  const tokens = t
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|a|an|walk|walks|walking|circular|trail|trails|family|friendly|kids|children|route|guide|short|easy|best|near|yorkshire|dales|moors|and|to|from|via|among|ruins|around|with|gallery|gardens?|woodland|parkland|at|on|for|stunning|views?|fantastic|inspirational|flat|paddl(?:e|ing)|spot|some|birds)\b/g,
      " ",
    )
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok, i, arr) => tok !== arr[i - 1]);
  return tokens.join(" ").trim();
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
