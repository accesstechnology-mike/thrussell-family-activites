import { USER_AGENT } from "../config";
import { extractFeatures, inferTerrain, slugId } from "../features";
import type { Activity } from "../types";

/**
 * English Heritage property finder HTML listing near a lat/lng.
 * Parses public search results pages — no API key.
 */
export async function fetchEnglishHeritage(
  origin: { lat: number; lng: number },
): Promise<Activity[]> {
  const url = `https://www.english-heritage.org.uk/visit/places/?location=${origin.lat},${origin.lng}&radius=80`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    next: { revalidate: 60 * 60 * 12 },
  });

  if (!res.ok) {
    throw new Error(`English Heritage listing failed (${res.status})`);
  }

  const html = await res.text();
  const now = new Date().toISOString();
  const activities: Activity[] = [];

  // Property cards typically link to /visit/places/<slug>/
  const cardRegex =
    /href="(https:\/\/www\.english-heritage\.org\.uk\/visit\/places\/[^"#?]+\/)"[^>]*>[\s\S]*?<img[^>]+(?:src|data-src)="([^"]+)"[^>]*(?:alt="([^"]*)")?[\s\S]{0,800}?<h[23][^>]*>([^<]+)<\/h[23]>/gi;

  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = cardRegex.exec(html))) {
    const sourceUrl = match[1];
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const imageUrl = match[2]?.startsWith("//")
      ? `https:${match[2]}`
      : match[2];
    const title = match[4].replace(/\s+/g, " ").trim();
    if (!title) continue;

    // Without coordinates in the listing HTML we geocode the place name via Nominatim.
    const geo = await geocodePlace(`${title}, Yorkshire, UK`);
    await sleep(1100);
    if (!geo) continue;

    const summary = `English Heritage place near ${title}.`;
    const features = extractFeatures(title, summary, "english heritage ruins castle");
    const terrainInfo = inferTerrain(null, summary);

    activities.push({
      id: slugId("english-heritage", title, sourceUrl),
      source: "english-heritage",
      sourceUrl,
      title,
      summary,
      imageUrl: imageUrl || null,
      imageAlt: match[3] || title,
      locationLabel: null,
      postcode: geo.postcode,
      what3words: null,
      coordinates: { lat: geo.lat, lng: geo.lng },
      parking: null,
      cost: "English Heritage membership / admission may apply",
      distanceMiles: null,
      terrain: terrainInfo.terrain,
      terrainNotes: null,
      features,
      categories: ["English Heritage"],
      driveMinutes: null,
      lastSyncedAt: now,
      rawFacts: {},
    });
  }

  // Fallback: if card regex found nothing, try simpler link scrape + geocode
  if (activities.length === 0) {
    const links = [
      ...html.matchAll(
        /href="(\/visit\/places\/[a-z0-9-]+\/)"[^>]*>\s*([^<]{3,80})\s*</gi,
      ),
    ];
    for (const [, path, rawTitle] of links.slice(0, 40)) {
      const sourceUrl = `https://www.english-heritage.org.uk${path}`;
      if (seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);
      const title = rawTitle.replace(/\s+/g, " ").trim();
      if (/places|filter|map|search/i.test(title)) continue;
      const geo = await geocodePlace(`${title}, England, UK`);
      await sleep(1100);
      if (!geo) continue;
      const features = extractFeatures(title, "english heritage");
      activities.push({
        id: slugId("english-heritage", title, sourceUrl),
        source: "english-heritage",
        sourceUrl,
        title,
        summary: `English Heritage place: ${title}.`,
        imageUrl: null,
        imageAlt: title,
        locationLabel: null,
        postcode: geo.postcode,
        what3words: null,
        coordinates: { lat: geo.lat, lng: geo.lng },
        parking: null,
        cost: "English Heritage membership / admission may apply",
        distanceMiles: null,
        terrain: "unknown",
        terrainNotes: null,
        features,
        categories: ["English Heritage"],
        driveMinutes: null,
        lastSyncedAt: now,
        rawFacts: {},
      });
    }
  }

  return activities;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodePlace(
  query: string,
): Promise<{ lat: number; lng: number; postcode: string | null } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name?: string;
  }>;
  const hit = data[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const postcodeMatch = hit.display_name?.match(
    /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,
  );
  return {
    lat,
    lng,
    postcode: postcodeMatch
      ? postcodeMatch[1].toUpperCase().replace(/\s+/, " ")
      : null,
  };
}
