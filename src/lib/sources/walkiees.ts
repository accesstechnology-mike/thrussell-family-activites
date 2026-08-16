import { USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import {
  asStringArray,
  jsonLdGraph,
  metaContent,
  sleep,
  stripTags,
} from "../html";
import type { Activity } from "../types";

const INDEX_URL = "https://walkiees.co.uk/dog-walks";
const NEARBY_REGION =
  /\b(yorkshire|cleveland|durham)\b/i;

/**
 * Walkiees community dog-walk listings for nearby counties.
 * Walks (including Ripley Castle) come from live JSON-LD, not a hardcoded list.
 */
export async function fetchWalkiees(): Promise<Activity[]> {
  const hubs = await discoverRegionHubs();
  const walkUrls = new Set<string>();
  for (const hub of hubs) {
    try {
      const html = await fetchHtml(hub);
      for (const url of collectWalkUrls(html)) walkUrls.add(url);
      await sleep(350);
    } catch {
      // Continue with other county hubs
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

async function discoverRegionHubs(): Promise<string[]> {
  const html = await fetchHtml(INDEX_URL);
  const hubs = [
    ...html.matchAll(/https:\/\/walkiees\.co\.uk\/dog-walks\/([a-z0-9-]+)/gi),
  ]
    .map((m) => m[0].replace(/\/$/, ""))
    .filter((url) => {
      const slug = url.split("/").pop() ?? "";
      return NEARBY_REGION.test(slug.replace(/-/g, " "));
    });
  return [...new Set(hubs)];
}

function collectWalkUrls(html: string): string[] {
  const urls = [
    ...html.matchAll(
      /https:\/\/walkiees\.co\.uk\/dog-walks\/([a-z0-9-]+)\/([a-z0-9-]+)/gi,
    ),
  ].map((m) => `https://walkiees.co.uk/dog-walks/${m[1]}/${m[2]}`);
  return [...new Set(urls)].filter((url) => {
    const region = url.split("/")[4] ?? "";
    return NEARBY_REGION.test(region.replace(/-/g, " "));
  });
}

async function enrichWalk(url: string, now: string): Promise<Activity | null> {
  const html = await fetchHtml(url);
  const nodes = jsonLdGraph(html);
  const walk = nodes.find((node) => {
    const types = asStringArray(node["@type"]);
    return (
      types.includes("TouristAttraction") || types.includes("LocalBusiness")
    );
  });
  if (!walk) return null;

  const name = typeof walk.name === "string" ? walk.name.trim() : "";
  if (name.length < 3) return null;

  const geo = (walk.geo ?? {}) as { latitude?: unknown; longitude?: unknown };
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = (walk.address ?? {}) as {
    addressLocality?: unknown;
    postalCode?: unknown;
  };
  const summary =
    (typeof walk.description === "string" && walk.description.trim()) ||
    metaContent(html, "og:description") ||
    `Dog walk from Walkiees: ${name}`;
  const image =
    (typeof walk.image === "string" && walk.image) ||
    metaContent(html, "og:image");
  const amenities = amenityNames(walk.amenityFeature);
  const terrainHints = asStringArray(walk.additionalType).join(", ");
  const ownText = [name, summary, amenities.join("\n"), terrainHints].join(
    "\n",
  );
  const features = extractFeatures(name, summary, ownText, "dog walk");
  if (!features.includes("dog friendly")) features.push("dog friendly");
  if (/forest|wood/i.test(terrainHints) && !features.includes("woodland")) {
    features.push("woodland");
  }
  if (/beach/i.test(terrainHints) && !features.includes("beach")) {
    features.push("beach");
  }

  const terrainInfo = inferTerrain(terrainHints || null, ownText);
  const body = stripTags(html);
  const what3words =
    body.match(/\/\/\/([a-z]+\.[a-z]+\.[a-z]+)/i)?.[1] ??
    body.match(/what3words\.com\/([a-z]+\.[a-z]+\.[a-z]+)/i)?.[1] ??
    null;

  return {
    id: slugId("walkiees", name, url),
    source: "walkiees",
    sourceUrl: url,
    title: name,
    summary,
    imageUrl: image,
    imageAlt: name,
    locationLabel:
      typeof address.addressLocality === "string"
        ? address.addressLocality
        : null,
    postcode:
      typeof address.postalCode === "string" ? address.postalCode : null,
    what3words,
    coordinates: { lat, lng },
    parking: amenities.find((a) => /parking/i.test(a)) ?? null,
    cost: walk.isAccessibleForFree === true ? "Free entry" : null,
    isFree: walk.isAccessibleForFree === true ? true : null,
    distanceMiles: null,
    terrain: terrainInfo.terrain,
    terrainNotes: terrainHints || terrainInfo.notes,
    features,
    categories: ["Walkiees", "Dog walk"],
    driveMinutes: null,
    lastSyncedAt: now,
    rawFacts: {
      amenities: amenities.join(", "),
      ...(terrainHints ? { walkType: terrainHints } : {}),
    },
  };
}

function amenityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "name" in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? name : "";
      }
      return "";
    })
    .filter(Boolean);
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Walkiees fetch failed (${res.status})`);
  return res.text();
}
