import { NATIONAL_TRUST_SEARCH_URL, USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import type { Activity } from "../types";

type NtResult = {
  id?: { value?: string };
  type?: string;
  title?: string;
  description?: string;
  town?: string | null;
  county?: string | null;
  location?: { lat?: number; lon?: number };
  links?: Array<{
    imageLink?: {
      href?: string;
      description?: string;
      caption?: string;
    };
    link?: {
      rel?: string;
      href?: string;
    };
  }>;
  tagRefs?: string[];
};

async function enrichPlacePage(url: string): Promise<{
  parking: string | null;
  cost: string | null;
  postcode: string | null;
  bodyText: string;
}> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 60 * 60 * 12 },
    });
    if (!res.ok) {
      return { parking: null, cost: null, postcode: null, bodyText: "" };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const postcodeMatch = text.match(
      /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,
    );
    const parkingMatch = text.match(
      /Parking[^.?]{0,160}[.!?]/i,
    );
    const costMatch = text.match(
      /(?:Admission|Entry|Prices?|Tickets?)[^.?]{0,160}[.!?]/i,
    );

    return {
      parking: parkingMatch?.[0]?.trim() ?? null,
      cost: costMatch?.[0]?.trim() ?? null,
      postcode: postcodeMatch
        ? postcodeMatch[1].toUpperCase().replace(/\s+/, " ")
        : null,
      bodyText: text.slice(0, 4000),
    };
  } catch {
    return { parking: null, cost: null, postcode: null, bodyText: "" };
  }
}

export async function fetchNationalTrust(
  origin: { lat: number; lng: number },
  radiusMiles: number,
): Promise<Activity[]> {
  const params = new URLSearchParams({
    query: "",
    lat: String(origin.lat),
    lon: String(origin.lng),
    distance: String(Math.ceil(radiusMiles)),
    size: "80",
  });

  const res = await fetch(`${NATIONAL_TRUST_SEARCH_URL}?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    next: { revalidate: 60 * 60 * 6 },
  });

  if (!res.ok) {
    throw new Error(`National Trust search failed (${res.status})`);
  }

  const data = (await res.json()) as {
    multiMatch?: { results?: NtResult[] };
  };
  const results = (data.multiMatch?.results ?? []).filter(
    (r) => r.type === "PLACE" && r.title && r.location?.lat && r.location?.lon,
  );

  const now = new Date().toISOString();
  const activities: Activity[] = [];

  for (const place of results) {
    const website =
      place.links?.find((l) => l.link?.rel === "website")?.link?.href ?? null;
    const image =
      place.links?.find((l) => l.imageLink?.href)?.imageLink ?? null;
    const enrichment = website
      ? await enrichPlacePage(website)
      : { parking: null, cost: null, postcode: null, bodyText: "" };

    const summary = place.description?.trim() || "National Trust place.";
    const locationLabel = [place.town, place.county].filter(Boolean).join(", ");
    const features = extractFeatures(
      place.title,
      summary,
      enrichment.bodyText,
      "national trust",
    );
    const terrainInfo = inferTerrain(null, summary, enrichment.bodyText);

    activities.push({
      id: slugId(
        "national-trust",
        place.title!,
        place.id?.value ?? website ?? place.title!,
      ),
      source: "national-trust",
      sourceUrl:
        website ??
        `https://www.nationaltrust.org.uk/search?query=${encodeURIComponent(place.title!)}`,
      title: place.title!,
      summary,
      imageUrl: image?.href ?? null,
      imageAlt: image?.description || image?.caption || place.title!,
      locationLabel: locationLabel || null,
      postcode: enrichment.postcode,
      what3words: null,
      coordinates: {
        lat: place.location!.lat!,
        lng: place.location!.lon!,
      },
      parking: enrichment.parking,
      cost: enrichment.cost ?? "National Trust membership / admission may apply",
      isFree: null,
      distanceMiles: null,
      terrain: terrainInfo.terrain,
      terrainNotes: terrainInfo.notes,
      features,
      categories: ["National Trust"],
      driveMinutes: null,
      lastSyncedAt: now,
      rawFacts: {
        town: place.town ?? "",
        county: place.county ?? "",
      },
    });
  }

  return activities;
}
