import { FEATURE_LABELS } from "./features";
import type { CardActivity } from "./query";
import type { Activity, DirectionsLinks } from "./types";

/** Machine-readable contract for Hermes and other agents. */
export function agentApiContract(baseUrl = "") {
  const root = baseUrl.replace(/\/$/, "");
  return {
    name: "Thrussell Outings",
    purpose:
      "Family outing picker for places within ~90 minutes of Catton (YO7 4SQ). Prefer these JSON endpoints over scraping the HTML UI.",
    audience: "Hermes and other agents — ask/suggest/list without browsing.",
    discovery: {
      llmsTxt: `${root}/llms.txt`,
      apiIndex: `${root}/api`,
      openapi: `${root}/api/openapi.json`,
    },
    howToUse: [
      "For a natural-language question or suggestion request, call GET /api/suggest?q=...",
      "For structured filters, call GET /api/activities with query params.",
      "For one outing with Maps/Tesla/weather, call GET /api/activities/{id}.",
      "Do not scrape the kid browse UI; all data is available as JSON.",
    ],
    endpoints: [
      {
        method: "GET",
        path: "/api",
        description: "This index — endpoint catalogue and known facets.",
      },
      {
        method: "GET",
        path: "/api/suggest",
        description:
          "Natural-language ask/suggest. Pass the user's question in q. Returns ranked outings with why[] reasons, maps links, and Tesla destination — usually one call is enough.",
        query: {
          q: "required — free text, e.g. 'stepping stones under 45 minutes'",
          limit: "optional — default 5, max 25",
          maxDrive: "optional — override interpreted drive cap (minutes)",
          includeWeather: "optional — 1/true to attach live weather (slower)",
        },
      },
      {
        method: "GET",
        path: "/api/activities",
        description: "List/filter cached outings. Default view=card includes logistics fields agents need.",
        query: {
          q: "substring search across title/summary/features/location/facts",
          feature: "single feature label (exact)",
          features: "comma-separated features — all must match",
          source: "single source id",
          sources: "comma-separated source ids",
          terrain: "flat|gentle|hilly|steep|unknown",
          terrains: "comma-separated terrains",
          maxDrive: "minutes from YO7 4SQ (default store max, usually 90)",
          minDrive: "minutes",
          maxDistanceMiles: "walk distance upper bound",
          free: "1/true — free / no admission (parking-only fees ok)",
          ids: "comma-separated activity ids",
          sort: "drive|title|distance|recent",
          limit: "page size",
          offset: "pagination offset",
          view: "card (default) | full (includes rawFacts + lastSyncedAt)",
        },
      },
      {
        method: "GET",
        path: "/api/activities/{id}",
        description:
          "Full activity + destination coords + Maps/Apple directions + Tesla string + weather.",
      },
      {
        method: "GET",
        path: "/api/weather",
        description: "Weather only. Query activityId=... or lat=&lng=.",
      },
      {
        method: "GET|POST",
        path: "/api/sync",
        description: "Refresh sources into the local cache (also Vercel cron). Prefer not to call casually.",
      },
    ],
    knownFeatures: FEATURE_LABELS,
    knownSources: [
      "reluctant-explorers",
      "national-trust",
      "english-heritage",
      "yorkshire-tots",
      "teesside-family-life",
      "muddy-boots-mummy",
      "little-vikings",
      "alltrails",
    ],
    knownTerrains: ["flat", "gentle", "hilly", "steep", "unknown"],
    originPostcode: "YO7 4SQ",
    examples: [
      `${root}/api/suggest?q=stepping%20stones%20under%2045%20minutes`,
      `${root}/api/suggest?q=pushchair%20friendly%20with%20ice%20cream`,
      `${root}/api/activities?features=cave,waterfall&maxDrive=60&view=card`,
      `${root}/api/activities?q=malham&view=full&limit=5`,
    ],
  };
}

export function serializeActivity(
  activity: Activity,
  view: "card" | "full",
): Activity | CardActivity {
  if (view === "full") return activity;
  const {
    lastSyncedAt: _lastSyncedAt,
    rawFacts: _rawFacts,
    ...card
  } = activity;
  return card;
}

export type SuggestPayloadActivity = CardActivity & {
  detailPath: string;
  apiDetailPath: string;
};

export function toSuggestActivity(activity: Activity): SuggestPayloadActivity {
  const card = serializeActivity(activity, "card") as CardActivity;
  return {
    ...card,
    detailPath: `/activity/${encodeURIComponent(activity.id)}`,
    apiDetailPath: `/api/activities/${encodeURIComponent(activity.id)}`,
  };
}

export type QuickDirections = Pick<
  DirectionsLinks,
  "googleMaps" | "googleMapsDirections" | "appleMaps" | "postcode" | "what3words"
> & {
  tesla: string;
};

export function quickDirections(
  activity: Activity,
  originPostcode: string,
): QuickDirections {
  const destQuery = `${activity.coordinates.lat},${activity.coordinates.lng}`;
  const label = encodeURIComponent(activity.title);
  return {
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${destQuery}`,
    googleMapsDirections: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originPostcode)}&destination=${destQuery}&travelmode=driving`,
    appleMaps: `https://maps.apple.com/?daddr=${destQuery}&q=${label}&dirflg=d`,
    postcode: activity.postcode,
    what3words: activity.what3words,
    tesla: activity.postcode
      ? activity.postcode
      : `${activity.coordinates.lat.toFixed(6)}, ${activity.coordinates.lng.toFixed(6)}`,
  };
}
