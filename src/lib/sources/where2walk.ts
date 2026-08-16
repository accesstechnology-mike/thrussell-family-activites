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
import { decodeEntities, stripTags } from "../html";
import type { Activity } from "../types";

const API = "https://where2walk.co.uk/wp-json/wp/v2";
const YORKSHIRE_TYPE =
  /yorkshire-dales|north_york_moors|howardian|wolds|bronte/i;

type WpWalk = {
  id: number;
  link: string;
  slug: string;
  title: { rendered: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  walk_type?: number[];
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url?: string; alt_text?: string }>;
  };
};

type WpTerm = {
  id: number;
  slug: string;
  name: string;
};

/**
 * Where2walk Yorkshire walk database via its public WordPress API.
 * Walk-type IDs are discovered live (Dales / Moors / Wolds), not hardcoded.
 */
export async function fetchWhere2walk(): Promise<Activity[]> {
  const typeIds = await discoverYorkshireTypeIds();
  const byId = new Map<number, WpWalk>();
  for (const typeId of typeIds) {
    const posts = await fetchWalksForType(typeId);
    for (const post of posts) byId.set(post.id, post);
  }

  const now = new Date().toISOString();
  const activities: Activity[] = [];
  const posts = [...byId.values()];
  let i = 0;
  for (const post of posts) {
    i += 1;
    const activity = await toActivity(post, now);
    if (activity) activities.push(activity);
    if (i % 20 === 0) {
      console.log(`Where2walk ${i}/${posts.length} (${activities.length} kept)`);
    }
  }
  return activities;
}

async function discoverYorkshireTypeIds(): Promise<number[]> {
  const terms: WpTerm[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await fetch(
      `${API}/walk_type?per_page=100&page=${page}`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) break;
    const batch = (await res.json()) as WpTerm[];
    if (!batch.length) break;
    terms.push(...batch);
    if (batch.length < 100) break;
  }
  return terms
    .filter((t) => YORKSHIRE_TYPE.test(`${t.slug} ${t.name}`))
    .map((t) => t.id);
}

async function fetchWalksForType(typeId: number): Promise<WpWalk[]> {
  const posts: WpWalk[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = `${API}/walk?walk_type=${typeId}&per_page=50&page=${page}&_embed=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) break;
    const batch = (await res.json()) as WpWalk[];
    if (!batch.length) break;
    posts.push(...batch);
    if (batch.length < 50) break;
  }
  return posts;
}

async function toActivity(
  post: WpWalk,
  now: string,
): Promise<Activity | null> {
  const title = decodeEntities(post.title.rendered || "").trim();
  if (title.length < 3) return null;
  const excerpt = stripTags(post.excerpt?.rendered || "");
  const body = stripTags(post.content?.rendered || "").slice(0, 6000);
  const summary = excerpt || `Walk from Where2walk: ${title}`;
  const image =
    post._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null;
  const ownText = [title, summary, body.slice(0, 1800)].join("\n");

  let postcode = extractPostcode(body) || extractPostcode(excerpt);
  let coords = postcode ? await geocodePostcode(postcode) : null;
  if (!coords) {
    const place = await geocodePlaceName(`${title}, Yorkshire, UK`, {
      maxVariants: 2,
    });
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
  const parking =
    body.match(/Parking[^.?]{0,160}[.!?]/i)?.[0]?.trim() ?? null;

  return {
    id: slugId("where2walk", title, post.link),
    source: "where2walk",
    sourceUrl: post.link,
    title,
    summary,
    imageUrl: image,
    imageAlt:
      post._embedded?.["wp:featuredmedia"]?.[0]?.alt_text || title,
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
    categories: ["Where2walk"],
    driveMinutes: null,
    lastSyncedAt: now,
    rawFacts: { wpId: String(post.id) },
  };
}
