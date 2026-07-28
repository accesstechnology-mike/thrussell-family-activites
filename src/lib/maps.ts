import { USER_AGENT } from "./config";
import type { Activity, DirectionsLinks, LatLng } from "./types";

function normaliseW3W(input: string): string | null {
  let words = input
    .trim()
    .toLowerCase()
    .replace(/^\/\/\//, "")
    .replace(/^\/+/g, "")
    .replace(/^\.+/g, "")
    .replace(/[\s,]+/g, ".")
    .replace(/\.+/g, ".");
  words = words.replace(/\.$/, "");
  const parts = words.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  return parts.join(".");
}

/**
 * Convert a what3words address to coordinates using the public page
 * (same approach as what3words-convert — no API key).
 */
export async function convertWhat3Words(
  w3w: string,
): Promise<LatLng & { words: string }> {
  const normalised = normaliseW3W(w3w);
  if (!normalised) {
    throw new Error("Invalid what3words address format");
  }

  const pageUrl = `https://what3words.com/${encodeURIComponent(normalised)}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!res.ok) {
    throw new Error(`what3words page request failed (${res.status})`);
  }

  const html = await res.text();
  const scriptMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
  );
  if (!scriptMatch?.[1]) {
    throw new Error("Failed to parse what3words page");
  }

  const jsonData = JSON.parse(scriptMatch[1]) as {
    props?: {
      pageProps?: {
        location?: {
          threeWordAddress?: string;
          coordinates?: { lat: number; lng: number };
        };
        countryConfig?: {
          coordinates?: { lat: number; lng: number };
        };
      };
    };
  };

  const location = jsonData.props?.pageProps?.location;
  const coords =
    location?.coordinates || jsonData.props?.pageProps?.countryConfig?.coordinates;

  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    throw new Error("No coordinates found for what3words address");
  }

  if (
    location?.threeWordAddress &&
    location.threeWordAddress.toLowerCase() !== normalised
  ) {
    throw new Error("what3words address did not match");
  }

  return { lat: coords.lat, lng: coords.lng, words: normalised };
}

/**
 * Prefer precise map coordinates from the activity; optionally refine parking
 * pin via what3words when present.
 */
export async function resolveDestination(
  activity: Activity,
): Promise<LatLng> {
  if (activity.what3words) {
    try {
      const pin = await convertWhat3Words(activity.what3words);
      return { lat: pin.lat, lng: pin.lng };
    } catch {
      // Fall back to stored coordinates from the source.
    }
  }
  return activity.coordinates;
}

export function buildDirectionsLinks(
  activity: Activity,
  destination: LatLng,
  originPostcode: string,
): DirectionsLinks {
  const destQuery = `${destination.lat},${destination.lng}`;
  const label = encodeURIComponent(activity.title);

  return {
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${destQuery}`,
    googleMapsDirections: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originPostcode)}&destination=${destQuery}&destination_place_id=&travelmode=driving`,
    appleMaps: `https://maps.apple.com/?daddr=${destQuery}&q=${label}&dirflg=d`,
    postcode: activity.postcode,
    what3words: activity.what3words,
    destinationLabel: activity.title,
  };
}

/** Tesla-friendly destination string: postcode when known, else lat,lng. */
export function teslaDestination(activity: Activity, destination: LatLng): string {
  if (activity.postcode) return activity.postcode;
  return `${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}`;
}
