import { USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import { fetchText, metaContent, sleep, stripTags } from "../html";
import {
  locationRawFacts,
  resolvePageLocation,
} from "../page-location";
import type { Activity, LatLng } from "../types";

/**
 * DogFriendly.co.uk days-out near home.
 * Search URL is built from the live origin geocode — listings are not hardcoded.
 */
export async function fetchDogFriendly(origin: LatLng): Promise<Activity[]> {
  const search = new URL("https://www.dogfriendly.co.uk/days-out");
  search.searchParams.set("category", "days-out");
  search.searchParams.set("lat", String(origin.lat));
  search.searchParams.set("lon", String(origin.lng));

  const listingUrls = new Set<string>();
  const html = await fetchHtml(search.href);
  for (const path of html.matchAll(/\/days-out\/listing\/([a-z0-9-]+)/gi)) {
    listingUrls.add(`https://www.dogfriendly.co.uk/days-out/listing/${path[1]}`);
  }

  const now = new Date().toISOString();
  const activities: Activity[] = [];
  for (const url of listingUrls) {
    try {
      const activity = await enrichListing(url, now);
      if (activity) activities.push(activity);
    } catch {
      // Skip failed listings
    }
    await sleep(250);
  }
  return activities;
}

async function enrichListing(
  url: string,
  now: string,
): Promise<Activity | null> {
  const html = await fetchHtml(url);
  const title = (
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    metaContent(html, "og:title") ||
    ""
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\s*[-–—|]\s*Dog Friendly.*$/i, "")
    .trim();
  if (title.length < 3) return null;

  const body = stripTags(html).slice(0, 6000);
  const summary =
    metaContent(html, "og:description") ||
    body.match(/Where are dogs allowed\?\s*([^.!?]{8,200})/i)?.[1]?.trim() ||
    `Dog-friendly day out: ${title}`;
  const image = metaContent(html, "og:image");
  const resolved = await resolvePageLocation({
    html,
    title,
    regionSuffix: "Yorkshire",
  });
  if (!resolved) return null;

  const parking =
    body.match(/Car Parking\s+([A-Za-z][^.]{0,80})/i)?.[0]?.trim() ?? null;
  const ownText = [title, summary, body.slice(0, 1200)].join("\n");
  const features = extractFeatures(title, summary, ownText, "dog friendly");
  if (!features.includes("dog friendly")) features.push("dog friendly");
  const terrainInfo = inferTerrain(null, ownText);

  return {
    id: slugId("dog-friendly", title, url),
    source: "dog-friendly",
    sourceUrl: url,
    title,
    summary,
    imageUrl: image,
    imageAlt: title,
    locationLabel: null,
    postcode: resolved.postcode,
    what3words: resolved.what3words,
    coordinates: { lat: resolved.lat, lng: resolved.lng },
    parking,
    cost: null,
    isFree: null,
    distanceMiles: null,
    terrain: terrainInfo.terrain,
    terrainNotes: terrainInfo.notes,
    features,
    categories: ["DogFriendly"],
    driveMinutes: null,
    lastSyncedAt: now,
    rawFacts: locationRawFacts(resolved),
  };
}

async function fetchHtml(url: string): Promise<string> {
  return fetchText(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
}
