import { USER_AGENT } from "../config";
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
import { metaContent, sleep, stripTags } from "../html";
import type { Activity } from "../types";

const REGION_INDEX =
  "https://theoutdoorguide.co.uk/walking-routes/walks-by-region/north-east-england/";

/**
 * The Outdoor Guide (Julia Bradbury) walk database — Yorkshire / Durham hubs
 * discovered from the live North East index.
 */
export async function fetchOutdoorGuide(): Promise<Activity[]> {
  const hubs = await discoverHubs();
  const walkUrls = new Set<string>();
  for (const hub of hubs) {
    try {
      const html = await fetchHtml(hub);
      for (const url of collectWalkUrls(html, hub)) walkUrls.add(url);
      await sleep(350);
    } catch {
      // Continue with other hubs
    }
  }

  const now = new Date().toISOString();
  const activities: Activity[] = [];
  for (const url of walkUrls) {
    try {
      const activity = await enrichWalk(url, now);
      if (activity) activities.push(activity);
    } catch {
      // Skip failed walk pages
    }
    await sleep(250);
  }
  return activities;
}

async function discoverHubs(): Promise<string[]> {
  const html = await fetchHtml(REGION_INDEX);
  const hubs = [
    ...html.matchAll(
      /(?:https:\/\/theoutdoorguide\.co\.uk)?\/walking-routes\/walks-by-region\/north-east-england\/(walks-in-[a-z0-9-]+)\//gi,
    ),
  ]
    .map(
      (m) =>
        `https://theoutdoorguide.co.uk/walking-routes/walks-by-region/north-east-england/${m[1]}/`,
    )
    .filter((url) => /yorkshire|durham/i.test(url));
  return [...new Set(hubs)];
}

function collectWalkUrls(html: string, hub: string): string[] {
  const prefix = hub.replace(/\/$/, "");
  const urls = [...html.matchAll(/href="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((href): href is string => Boolean(href))
    .map((href) =>
      href.startsWith("http")
        ? href
        : new URL(href, "https://theoutdoorguide.co.uk").href,
    )
    .filter(
      (url) =>
        url.startsWith(`${prefix}/`) &&
        url.replace(/\/$/, "") !== prefix &&
        !/[?#]/.test(url),
    )
    .map((url) => (url.endsWith("/") ? url : `${url}/`));
  return [...new Set(urls)];
}

async function enrichWalk(url: string, now: string): Promise<Activity | null> {
  const html = await fetchHtml(url);
  const title = (
    metaContent(html, "og:title") ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    ""
  )
    .replace(/\s*[-–—|]\s*The Outdoor Guide.*$/i, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  if (title.length < 4) return null;
  if (/^walks in /i.test(title)) return null;

  const summary =
    metaContent(html, "og:description") ||
    `Family walk from The Outdoor Guide: ${title}`;
  const image = metaContent(html, "og:image");
  const body = stripTags(html).slice(0, 8000);
  const parking =
    body.match(/Carpark:\s*([^.]{8,180})/i)?.[1]?.trim() ??
    body.match(/Parking[:\s]+([^.]{8,160})/i)?.[0]?.trim() ??
    null;
  const ownText = [title, summary, parking, body.slice(0, 1800)].join("\n");

  let postcode = extractPostcode(parking || "") || extractPostcode(body);
  let coords = postcode ? await geocodePostcode(postcode) : null;
  if (!coords) {
    const place = await geocodePlaceName(`${title}, Yorkshire, UK`);
    if (!place) return null;
    coords = {
      lat: place.lat,
      lng: place.lng,
      postcode: place.postcode ?? postcode ?? "",
    };
    postcode = place.postcode ?? postcode;
  }

  const terrainInfo = inferTerrain(null, ownText);
  const features = extractFeatures(title, summary, ownText);
  if (/\bdog/i.test(ownText) && !features.includes("dog friendly")) {
    features.push("dog friendly");
  }

  return {
    id: slugId("outdoor-guide", title, url),
    source: "outdoor-guide",
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
    distanceMiles: parseDistanceMiles(ownText),
    terrain: terrainInfo.terrain,
    terrainNotes: terrainInfo.notes,
    features,
    categories: ["The Outdoor Guide"],
    driveMinutes: null,
    lastSyncedAt: now,
    rawFacts: {},
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Outdoor Guide fetch failed (${res.status})`);
  return res.text();
}
