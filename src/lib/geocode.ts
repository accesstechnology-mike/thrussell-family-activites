import { USER_AGENT } from "./config";
import type { LatLng } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocodePostcode(
  postcode: string,
): Promise<(LatLng & { postcode: string }) | null> {
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
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
    return null;
  }
  return {
    lat: data.result.latitude,
    lng: data.result.longitude,
    postcode: data.result.postcode ?? postcode,
  };
}

/** Nominatim geocode with polite pacing. */
export async function geocodePlaceName(
  query: string,
): Promise<(LatLng & { postcode: string | null }) | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  await sleep(1100);
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

export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}
