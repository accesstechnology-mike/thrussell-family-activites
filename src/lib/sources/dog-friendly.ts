import { USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import {
  extractPostcode,
  geocodePlaceName,
  geocodePostcode,
} from "../geocode";
import { metaContent, sleep, stripTags } from "../html";
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
  const postcode = extractPostcode(body);
  const lat = Number(
    html.match(/lat(?:itude)?["\s:=]+([0-9.-]+)/i)?.[1] ?? "",
  );
  const lng = Number(
    html.match(/lon(?:gitude)?["\s:=]+([0-9.-]+)/i)?.[1] ?? "",
  );

  let coords =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, postcode: postcode ?? "" }
      : postcode
        ? await geocodePostcode(postcode)
        : null;
  if (!coords) {
    const place = await geocodePlaceName(`${title}, Yorkshire, UK`);
    if (!place) return null;
    coords = {
      lat: place.lat,
      lng: place.lng,
      postcode: place.postcode ?? postcode ?? "",
    };
  }

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
    postcode: postcode || coords.postcode || null,
    what3words: null,
    coordinates: { lat: coords.lat, lng: coords.lng },
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
    rawFacts: {},
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`DogFriendly fetch failed (${res.status})`);
  return res.text();
}
