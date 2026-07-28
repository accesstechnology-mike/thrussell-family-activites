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
import type { Activity } from "../types";

const API = "https://www.teessidefamilylife.co.uk/wp-json/wp/v2/posts";
const NORTH_YORKSHIRE_CATEGORY = 22;

type WpPost = {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url?: string; alt_text?: string }>;
  };
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
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

function looksLikeOuting(title: string, text: string): boolean {
  const hay = `${title}\n${text}`.toLowerCase();
  if (/coach trips|play cafe|places to drink|things to do in saltburn|summer holidays guide/i.test(hay)) {
    return false;
  }
  return /\b(walk|walking|stepping stones|waterfall|foss|force|woods|moor|beach|trail|nature reserve|gardens|park)\b/i.test(
    hay,
  );
}

async function fetchPosts(): Promise<WpPost[]> {
  const urls = [
    `${API}?categories=${NORTH_YORKSHIRE_CATEGORY}&per_page=20&_embed=1`,
    `${API}?search=walk&per_page=20&_embed=1`,
    `${API}?search=stepping%20stones&per_page=10&_embed=1`,
    `${API}?search=waterfall&per_page=10&_embed=1`,
  ];

  const byId = new Map<number, WpPost>();
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) continue;
    const posts = (await res.json()) as WpPost[];
    for (const post of posts) byId.set(post.id, post);
  }
  return [...byId.values()];
}

async function toActivity(post: WpPost): Promise<Activity | null> {
  const title = decodeEntities(post.title.rendered).trim();
  let contentHtml = post.content?.rendered ?? "";
  if (!contentHtml) {
    const res = await fetch(`${API}/${post.id}?_embed=1`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (res.ok) {
      const full = (await res.json()) as WpPost;
      contentHtml = full.content?.rendered ?? "";
      post._embedded = full._embedded ?? post._embedded;
    }
  }

  const excerpt = stripTags(post.excerpt?.rendered ?? "");
  const body = stripTags(contentHtml);
  if (!looksLikeOuting(title, `${excerpt}\n${body}`)) return null;

  let postcode = extractPostcode(body);
  let coords = postcode ? await geocodePostcode(postcode) : null;
  if (!coords) {
    const place = await geocodePlaceName(`${title}, North Yorkshire, UK`);
    if (!place) return null;
    coords = {
      lat: place.lat,
      lng: place.lng,
      postcode: place.postcode ?? postcode ?? "",
    };
    postcode = place.postcode ?? postcode;
  }

  const image =
    post._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null;
  const imageAlt =
    post._embedded?.["wp:featuredmedia"]?.[0]?.alt_text || title;
  const ownText = [title, excerpt, body.slice(0, 2000)].join("\n");
  const terrainInfo = inferTerrain(null, ownText);
  const features = extractFeatures(title, excerpt, ownText);
  const parkingMatch = body.match(/Parking[^.?]{0,180}[.!?]/i);
  const costMatch = body.match(
    /(?:Admission|Entry|Ticket|Cost|Price|Free)[^.?]{0,140}[.!?]/i,
  );

  return {
    id: slugId("teesside-family-life", title, post.link),
    source: "teesside-family-life",
    sourceUrl: post.link,
    title,
    summary: excerpt || `Family outing from Teesside Family Life: ${title}`,
    imageUrl: image,
    imageAlt,
    locationLabel: "North Yorkshire",
    postcode: postcode || coords.postcode || null,
    what3words: null,
    coordinates: { lat: coords.lat, lng: coords.lng },
    parking: parkingMatch?.[0]?.trim() ?? null,
    cost: costMatch?.[0]?.trim() ?? null,
    distanceMiles: parseDistanceMiles(ownText),
    terrain: terrainInfo.terrain,
    terrainNotes: terrainInfo.notes,
    features,
    categories: ["Teesside Family Life"],
    driveMinutes: null,
    lastSyncedAt: new Date().toISOString(),
    rawFacts: { slug: post.slug },
  };
}

export async function fetchTeessideFamilyLife(): Promise<Activity[]> {
  const posts = await fetchPosts();
  const activities: Activity[] = [];
  for (const post of posts) {
    try {
      const activity = await toActivity(post);
      if (activity) activities.push(activity);
    } catch {
      // Skip failed posts
    }
  }
  return activities;
}
