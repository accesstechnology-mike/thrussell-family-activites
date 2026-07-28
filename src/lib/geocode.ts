import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_AGENT } from "./config";
import type { LatLng } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GeoHit = LatLng & { postcode: string | null };
type CacheFile = Record<string, GeoHit | null>;

const CACHE_PATH = path.join(process.cwd(), "data", "geocode-cache.json");
let memoryCache: CacheFile | null = null;
let cacheDirty = false;

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

/** Nominatim geocode with polite pacing and query fallbacks. */
export async function geocodePlaceName(
  query: string,
): Promise<(LatLng & { postcode: string | null }) | null> {
  const cache = await loadCache();
  const primaryKey = `place:${cacheKey(query)}`;
  if (primaryKey in cache) return cache[primaryKey] ?? null;

  for (const q of geocodeQueryVariants(query)) {
    const key = `place:${cacheKey(q)}`;
    if (key in cache) {
      const cached = cache[key];
      if (cached) {
        cache[primaryKey] = cached;
        cacheDirty = true;
        await saveCache();
        return cached;
      }
      continue;
    }
    const hit = await nominatimSearch(q);
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

function geocodeQueryVariants(query: string): string[] {
  const variants: string[] = [query];

  const region =
    query.match(/,\s*([^,]+,\s*UK)\s*$/i)?.[1] ?? "Yorkshire, UK";

  const core = query
    .replace(/,\s*[^,]+,\s*UK\s*$/i, "")
    .replace(/,\s*UK\s*$/i, "")
    .trim();

  if (core.includes(":")) {
    const after = core.split(":").slice(1).join(":").trim();
    if (after.length > 3) {
      variants.push(`${after}, ${region}`, `${after}, Yorkshire, UK`);
    }
  }

  const stripped = core
    .replace(
      /\b(circular|trail|trails|walks?|walking|route|explorer)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length > 3) {
    variants.push(`${stripped}, ${region}`, `${stripped}, Yorkshire, UK`);
  }

  const chunks = core
    .replace(/^[^:]+:\s*/, "")
    .split(/\s*(?:,| and | to | & )\s*/i)
    .map((c) =>
      c
        .replace(/\b(circular|trail|trails|walks?|route|explorer)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((c) => c.length >= 4 && !/^(old|the|and)$/i.test(c));

  for (const chunk of chunks.slice(0, 4)) {
    variants.push(
      `${chunk}, North Yorkshire, UK`,
      `${chunk}, Yorkshire, UK`,
      `${chunk}, York, UK`,
      `${chunk}, Cumbria, UK`,
    );
    const words = chunk.split(/\s+/).filter(Boolean);
    for (let n = Math.min(words.length, 4); n >= 1; n--) {
      const short = words.slice(0, n).join(" ");
      if (short.length < 5) continue;
      variants.push(
        `${short}, North Yorkshire, UK`,
        `${short}, Yorkshire, UK`,
        `${short}, Cumbria, UK`,
      );
    }
  }

  // City walls / similar landmarks that Nominatim titles oddly
  if (/york.*walls|walls.*york/i.test(core)) {
    variants.push("York city walls, York, England", "York, England");
  }

  return [...new Set(variants.filter(Boolean))];
}

async function nominatimSearch(
  query: string,
): Promise<(LatLng & { postcode: string | null }) | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(query)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    await sleep(1200);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
    }>;
    const hit = data[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const postcodeMatch = hit.display_name?.match(
      /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,
    );
    return {
      lat,
      lng,
      postcode: postcodeMatch
        ? postcodeMatch[1].toUpperCase().replace(/\s+/, " ")
        : null,
    };
  }
  return null;
}

export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}
