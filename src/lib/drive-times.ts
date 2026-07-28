import { USER_AGENT } from "./config";
import type { LatLng } from "./types";

type CacheEntry = {
  expiresAt: number;
  times: Record<string, number>;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function coordPair(loc: LatLng): string {
  return `${loc.lng},${loc.lat}`;
}

/**
 * Real driving durations (minutes) from origin via public OSRM table API.
 * Batches destinations to stay within URL limits.
 */
export async function getDriveTimesMinutes(
  origin: LatLng,
  destinations: Array<{ id: string; location: LatLng }>,
): Promise<Record<string, number>> {
  if (destinations.length === 0) return {};

  const cacheKey = `${coordPair(origin)}|${destinations
    .map((d) => `${d.id}:${coordPair(d.location)}`)
    .join(";")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.times;
  }

  const times: Record<string, number> = {};
  const batchSize = 80;

  for (let i = 0; i < destinations.length; i += batchSize) {
    const batch = destinations.slice(i, i + batchSize);
    const destCoords = batch.map((d) => coordPair(d.location)).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coordPair(origin)};${destCoords}?sources=0&annotations=duration`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      throw new Error(`OSRM drive-time request failed (${res.status})`);
    }

    const data = (await res.json()) as {
      durations?: (number | null)[][];
      code?: string;
    };

    if (data.code !== "Ok" || !data.durations?.[0]) {
      throw new Error("OSRM returned no drive durations");
    }

    const secondsRow = data.durations[0].slice(1);
    batch.forEach((dest, idx) => {
      const seconds = secondsRow[idx];
      if (typeof seconds === "number") {
        times[dest.id] = Math.round(seconds / 60);
      }
    });
  }

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, times });
  return times;
}
