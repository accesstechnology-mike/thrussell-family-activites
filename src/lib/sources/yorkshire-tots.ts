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
import type { Activity } from "../types";

const HUBS = [
  "https://yorkshiretots.com/yorkshire-walks/",
  "https://yorkshiretots.com/yorkshire-walks-families/",
  "https://yorkshiretots.com/yorkshire-waterfall-walks-for-families/",
  "https://yorkshiretots.com/family-friendly-stepping-stones-walks-in-yorkshire/",
  "https://yorkshiretots.com/pram-friendly-walks-in-yorkshire/",
  "https://yorkshiretots.com/family-adventure-walks-in-yorkshire/",
];

/** Roundup / hub pages — not single outing destinations. */
const SKIP_SLUGS = new Set([
  "yorkshire-walks",
  "yorkshire-walks-families",
  "yorkshire-waterfall-walks-for-families",
  "family-friendly-stepping-stones-walks-in-yorkshire",
  "pram-friendly-walks-in-yorkshire",
  "family-dog-friendly-walks-in-yorkshire",
  "family-adventure-walks-in-yorkshire",
  "family-friendly-bluebell-walks-yorkshire",
  "5-yorkshire-family-walks-fantastic-cafes",
  "10-stunning-kid-dog-friendly-autumn-walks-in-yorkshire",
  "10-fabulous-free-walking-trails-for-kids-in-yorkshire",
  "yorkshire-family-walks-adventure-playgrounds",
  "family-walks-west-yorkshire",
  "family-walks-in-wakefield",
  "5-fantastic-pram-friendly-walks-around-leeds",
  "free-woodland-walks-in-the-selby-district-yorkshire",
  "winter-walks-yorkshire",
  "bolton-abbey-pumpkin-trail",
  "lotherton-hall-spooky-scarecrow-trail",
]);

const BROWSER_UA =
  "Mozilla/5.0 (compatible; thrussell-family-activities/1.0; +local family app) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function slugFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").pop() ?? "";
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`Yorkshire Tots fetch failed (${res.status})`);
  return res.text();
}

function collectWalkUrls(hubHtml: string): string[] {
  const links = [
    ...hubHtml.matchAll(/https:\/\/yorkshiretots\.com\/([a-z0-9-]+)\/?/gi),
  ].map((m) => `https://yorkshiretots.com/${m[1]}/`);
  return [...new Set(links)].filter((url) => {
    const slug = slugFromUrl(url);
    if (!slug || SKIP_SLUGS.has(slug)) return false;
    if (/^(category|tag|author|page|wp-)/i.test(slug)) return false;
    // Prefer walk-ish destinations; still allow specific outing posts.
    return /walk|falls|foss|force|woods|reservoir|stepping|chevin|abbey|crag|waterfall|trail|gill|moor|bay|foss/i.test(
      slug,
    );
  });
}

function extractParking(text: string): string | null {
  const m = text.match(/Parking[^.?]{0,180}[.!?]/i);
  return m?.[0]?.trim() ?? null;
}

function extractCost(text: string): string | null {
  const m = text.match(
    /(?:Admission|Entry|Ticket|Cost|Price|Free entry|Pay and display)[^.?]{0,160}[.!?]/i,
  );
  return m?.[0]?.trim() ?? null;
}

async function enrichWalk(url: string): Promise<Activity | null> {
  const html = await fetchHtml(url);
  const title = decodeEntities(
    html
      .match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
      ?.replace(/\s*[|–—-]\s*Yorkshire Tots.*$/i, "")
      .trim() ||
      html
        .match(/<title>([^<]+)<\/title>/i)?.[1]
        ?.replace(/\s*[|–—-]\s*Yorkshire Tots.*$/i, "")
        .trim() ||
      slugFromUrl(url),
  );

  if (/^\d+\s/.test(title) && /walks/i.test(title)) return null;

  const summary = decodeEntities(
    html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1]?.trim() ||
      "",
  );
  const imageUrl =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ?? null;
  const body = stripTags(html).slice(0, 6000);
  const ownText = [title, summary, body.slice(0, 1800)].join("\n");

  let postcode = extractPostcode(body);
  let coords = postcode ? await geocodePostcode(postcode) : null;
  if (!coords) {
    // Try a shorter place query from the slug when the SEO title is noisy.
    const slugGuess = slugFromUrl(url).replace(/-/g, " ");
    const place =
      (await geocodePlaceName(`${slugGuess}, Yorkshire, UK`)) ||
      (await geocodePlaceName(`${title}, Yorkshire, UK`));
    if (!place) return null;
    coords = {
      lat: place.lat,
      lng: place.lng,
      postcode: place.postcode ?? postcode ?? "",
    };
    postcode = place.postcode ?? postcode;
  }

  const terrainInfo = inferTerrain(null, ownText);
  const features = extractFeatures(title, summary, ownText, "yorkshire family walk");
  const now = new Date().toISOString();

  return {
    id: slugId("yorkshire-tots", title, url),
    source: "yorkshire-tots",
    sourceUrl: url,
    title,
    summary: summary || `Family outing from Yorkshire Tots to Teens: ${title}`,
    imageUrl,
    imageAlt: title,
    locationLabel: null,
    postcode: postcode || coords.postcode || null,
    what3words: null,
    coordinates: { lat: coords.lat, lng: coords.lng },
    parking: extractParking(body),
    cost: extractCost(body),
    isFree: null,
    distanceMiles: parseDistanceMiles(ownText),
    terrain: terrainInfo.terrain,
    terrainNotes: terrainInfo.notes,
    features,
    categories: ["Yorkshire Tots"],
    driveMinutes: null,
    lastSyncedAt: now,
    rawFacts: {},
  };
}

async function collectHubUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const hub of HUBS) {
    try {
      const html = await fetchHtml(hub);
      for (const url of collectWalkUrls(html)) urls.add(url);
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      // Continue with other hubs
    }
  }
  return urls;
}

export async function fetchYorkshireTots(): Promise<Activity[]> {
  let urls = await collectHubUrls();
  // Site occasionally WAF-throttles when sync hits many sources; one pause+retry.
  if (urls.size === 0) {
    await new Promise((r) => setTimeout(r, 2500));
    urls = await collectHubUrls();
  }

  // Sequential: Nominatim needs polite pacing for pages without postcodes.
  const activities: Activity[] = [];
  for (const url of urls) {
    try {
      const activity = await enrichWalk(url);
      if (activity) activities.push(activity);
    } catch {
      // Skip failed pages
    }
  }
  return activities;
}
