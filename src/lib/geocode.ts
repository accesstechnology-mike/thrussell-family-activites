import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_AGENT } from "./config";
import { getOrigin } from "./origin";
import type { LatLng } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GeoHit = LatLng & { postcode: string | null; name?: string | null };
type CacheFile = Record<string, GeoHit | null>;

const CACHE_PATH = path.join(process.cwd(), "data", "geocode-cache.json");
let memoryCache: CacheFile | null = null;
let cacheDirty = false;

/** Bump when query/match rules change so stale Nominatim misses are not reused. */
const PLACE_CACHE_PREFIX = "placev2:";

async function loadCache(): Promise<CacheFile> {
  if (memoryCache) return memoryCache;
  try {
    memoryCache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as CacheFile;
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function saveCache(): Promise<void> {
  if (!memoryCache || !cacheDirty) return;
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, `${JSON.stringify(memoryCache, null, 2)}\n`, "utf8");
  cacheDirty = false;
}

function cacheKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function geocodePostcode(
  postcode: string,
): Promise<(LatLng & { postcode: string }) | null> {
  const normalised = postcode.toUpperCase().replace(/\s+/g, " ").trim();
  const cache = await loadCache();
  const key = `pc:${normalised}`;
  if (key in cache) {
    const hit = cache[key];
    return hit ? { lat: hit.lat, lng: hit.lng, postcode: hit.postcode || normalised } : null;
  }

  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    cache[key] = null;
    cacheDirty = true;
    await saveCache();
    return null;
  }
  const data = (await res.json()) as {
    status: number;
    result?: { latitude: number; longitude: number; postcode?: string };
  };
  if (
    data.status !== 200 ||
    !data.result ||
    typeof data.result.latitude !== "number" ||
    typeof data.result.longitude !== "number"
  ) {
    cache[key] = null;
    cacheDirty = true;
    await saveCache();
    return null;
  }
  const hit = {
    lat: data.result.latitude,
    lng: data.result.longitude,
    postcode: data.result.postcode ?? normalised,
  };
  cache[key] = hit;
  cacheDirty = true;
  await saveCache();
  return hit;
}

function haversineKm(a: LatLng, b: LatLng): number {
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

/** Nominatim geocode with polite pacing and query fallbacks.
 * Last resort only — prefer resolvePageLocation (page lat/lng, OS grid, postcode, what3words).
 */
export async function geocodePlaceName(
  query: string,
  opts?: { maxVariants?: number; near?: LatLng; maxKm?: number },
): Promise<(LatLng & { postcode: string | null }) | null> {
  const near = opts?.near ?? (await getOrigin()).location;
  const maxKm = opts?.maxKm ?? 160;
  const cache = await loadCache();
  const primaryKey = `${PLACE_CACHE_PREFIX}${cacheKey(query)}`;
  if (primaryKey in cache) {
    const cached = cache[primaryKey];
    if (cached) {
      if (
        (cached.name && !nominatimNameFitsQuery(query, cached.name)) ||
        haversineKm(near, cached) > maxKm
      ) {
        delete cache[primaryKey];
      } else {
        return cached;
      }
    }
    // Cached miss for this exact string — still try cleaned variants.
  }

  const variants = geocodeQueryVariants(query).slice(
    0,
    opts?.maxVariants ?? 12,
  );
  for (const q of variants) {
    const key = `${PLACE_CACHE_PREFIX}${cacheKey(q)}`;
    if (key in cache) {
      const cached = cache[key];
      if (cached) {
        if (
          (cached.name && !nominatimNameFitsQuery(q, cached.name)) ||
          haversineKm(near, cached) > maxKm
        ) {
          delete cache[key];
        } else {
          cache[primaryKey] = cached;
          cacheDirty = true;
          await saveCache();
          return cached;
        }
      } else {
        continue;
      }
    }
    let hit: GeoHit | null;
    try {
      hit = await nominatimSearch(q, near, maxKm);
    } catch {
      // Transport / rate-limit — do not cache a miss.
      continue;
    }
    cache[key] = hit;
    cacheDirty = true;
    if (hit) {
      cache[primaryKey] = hit;
      await saveCache();
      return hit;
    }
  }

  cache[primaryKey] = null;
  cacheDirty = true;
  await saveCache();
  return null;
}

const QUERY_NOISE =
  /\b(circular|trail|trails|walks?|walking|route|explorer|discover)\b/gi;
const LEADING_NOISE = /^(on|from|via|to|at|near|the|a|an|over|around)\s+/i;
const GENERIC_TAIL =
  /^(moor|top|fell|edge|side|end|common|park|wood|hall|hill|head|bridge)$/i;

const REGION_SUFFIXES = [
  "",
  "UK",
  "Yorkshire Dales, UK",
  "Cumbria, UK",
  "North Yorkshire, UK",
  "Yorkshire, UK",
] as const;

/** Strip walk-title filler so "Walk on Skipton Moor" becomes "Skipton Moor". */
export function cleanPlacePhrase(text: string): string {
  let s = text
    .replace(/,\s*[^,]+,\s*UK\s*$/i, "")
    .replace(/,\s*UK\s*$/i, "")
    .replace(/^[^:]+:\s*/, "")
    .replace(QUERY_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  while (LEADING_NOISE.test(s)) {
    s = s.replace(LEADING_NOISE, "").trim();
  }
  return s;
}

export function geocodeQueryVariants(query: string): string[] {
  const variants: string[] = [];
  const add = (value: string) => {
    const trimmed = value.replace(/\s+/g, " ").trim().replace(/^,|,$/g, "").trim();
    if (trimmed.length >= 4) variants.push(trimmed);
  };
  const withRegions = (place: string) => {
    for (const suffix of REGION_SUFFIXES) {
      add(suffix ? `${place}, ${suffix}` : place);
    }
  };

  const cleaned = cleanPlacePhrase(query);
  const chunks = cleaned
    .split(/\s*(?:,| and | to | & )\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.length >= 4 && !/^(old|the|and)$/i.test(c));

  // Bare place names first so "Calf Top" wins over a failed "X and Y, Yorkshire".
  if (cleaned) add(cleaned);
  for (const chunk of chunks.slice(0, 4)) add(chunk);
  if (cleaned) withRegions(cleaned);
  for (const chunk of chunks.slice(0, 4)) {
    withRegions(chunk);
    const words = chunk.split(/\s+/).filter(Boolean);
    for (let n = Math.min(words.length, 3); n >= 1; n -= 1) {
      const short = words.slice(-n).join(" ");
      if (short.length < 5) continue;
      if (GENERIC_TAIL.test(short)) continue;
      withRegions(short);
    }
  }

  if (/york.*walls|walls.*york/i.test(cleaned) || /york.*walls|walls.*york/i.test(query)) {
    add("York city walls, York, England");
  }

  add(query);
  return [...new Set(variants)];
}

const PLACE_STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "from",
  "via",
  "with",
  "for",
  "walk",
  "walks",
  "walking",
  "circular",
  "trail",
  "trails",
  "route",
  "explorer",
  "discover",
  "uk",
  "united",
  "kingdom",
  "england",
  "yorkshire",
  "north",
  "south",
  "west",
  "east",
  "dales",
  "moors",
  "cumbria",
  "near",
  "over",
  "around",
]);

export function significantPlaceTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && !PLACE_STOP.has(t));
}

/**
 * Reject nearby homonyms: "Skipton-on-Swale" for Skipton Moor,
 * "Calf Close Top" (Dishforth meadow) for Calf Top.
 */
export function nominatimNameFitsQuery(query: string, name: string): boolean {
  const q = significantPlaceTokens(query);
  const n = significantPlaceTokens(name);
  if (!q.length || !n.length) return false;
  const qSet = new Set(q);
  const extra = n.filter((t) => !qSet.has(t) && t.length >= 4);
  if (extra.length) return false;
  return n.some((t) => qSet.has(t));
}

const PREFERRED_TYPES = new Set([
  "peak",
  "moor",
  "heath",
  "valley",
  "fell",
  "mountain",
  "village",
  "town",
  "city",
  "hamlet",
  "suburb",
  "natural",
  "wood",
  "forest",
  "park",
  "water",
  "reservoir",
  "lake",
  "waterfall",
  "attraction",
]);

type NominatimRow = {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  importance?: number;
  class?: string;
  type?: string;
};

function scoreNominatimRow(query: string, row: NominatimRow): number | null {
  const name = row.name || row.display_name?.split(",")[0] || "";
  if (!nominatimNameFitsQuery(query, name)) return null;
  const q = significantPlaceTokens(query);
  const n = significantPlaceTokens(name);
  const shared = n.filter((t) => q.includes(t)).length;
  const cleaned = cleanPlacePhrase(query).toLowerCase();
  const exact =
    name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
    cleaned.replace(/[^a-z0-9]+/g, " ").trim()
      ? 50
      : 0;
  const preferred =
    PREFERRED_TYPES.has(row.type || "") || PREFERRED_TYPES.has(row.class || "")
      ? 5
      : 0;
  return exact + shared * 10 + preferred + (row.importance ?? 0);
}

async function nominatimSearch(
  query: string,
  near: LatLng,
  maxKm: number,
): Promise<GeoHit | null> {
  const padLat = maxKm / 111;
  const padLng = maxKm / (111 * Math.cos((near.lat * Math.PI) / 180));
  const viewbox = [
    near.lng - padLng,
    near.lat + padLat,
    near.lng + padLng,
    near.lat - padLat,
  ].join(",");
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=gb` +
    `&viewbox=${encodeURIComponent(viewbox)}&bounded=0` +
    `&q=${encodeURIComponent(query)}`;

  let transportFailed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (res.status === 429 || res.status >= 500) {
      transportFailed = true;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    await sleep(1200);
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimRow[];
    let best: { row: NominatimRow; score: number; loc: LatLng } | null = null;
    for (const row of data) {
      const score = scoreNominatimRow(query, row);
      if (score == null) continue;
      const loc = { lat: Number(row.lat), lng: Number(row.lon) };
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      if (haversineKm(near, loc) > maxKm) continue;
      if (!best || score > best.score) best = { row, score, loc };
    }
    if (!best) return null;
    const display = best.row.display_name;
    const postcodeMatch = display?.match(
      /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,
    );
    return {
      lat: best.loc.lat,
      lng: best.loc.lng,
      postcode: postcodeMatch
        ? postcodeMatch[1].toUpperCase().replace(/\s+/, " ")
        : null,
      name: best.row.name || display?.split(",")[0] || null,
    };
  }
  if (transportFailed) {
    throw new Error(`Nominatim unavailable for ${query}`);
  }
  return null;
}

export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}
