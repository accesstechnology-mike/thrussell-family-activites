import {
  RELUCTANT_EXPLORERS_KML_URL,
  USER_AGENT,
} from "../config";
import {
  extractFeatures,
  inferTerrain,
  parseDistanceMiles,
  slugId,
} from "../features";
import type { Activity, LatLng } from "../types";

type Placemark = {
  name: string;
  description: string;
  coordinates: LatLng;
  folder: string;
};

const MENU_SLUGS = new Set([
  "about-us",
  "walks-by-location",
  "home",
  "yorkshire-dales",
  "nidderdale-walks",
  "ilkley-walks",
  "otley-washburn-walks",
  "walks-with-play-parks",
  "pushchair-friendly-walks",
  "reservoir-walks",
  "child-friendly-woodland-walks",
  "child-friendly-walks-with-water",
  "free-printable-scavenger-sheets",
  "walking-games",
  "nature-collectors-craft",
  "paper-sailing-boats",
  "blackberry-picking",
  "polyjuice-potion",
  "star-gazing-outdoors",
  "little-peak-baggers",
  "blog",
]);

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeXml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl(description: string): string | null {
  const match = description.match(
    /https?:\/\/(?:www\.)?thereluctantexplorers\.com\/[a-z0-9-]+/i,
  );
  return match ? match[0] : null;
}

function parseKml(kml: string): Placemark[] {
  const placemarks: Placemark[] = [];
  const folderBlocks = kml.split(/<Folder>/i).slice(1);

  for (const folderBlock of folderBlocks) {
    const folderNameMatch = folderBlock.match(/<name>([^<]*)<\/name>/i);
    const folder = folderNameMatch
      ? decodeXml(folderNameMatch[1]).trim()
      : "Walks";
    const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/gi;
    let pmMatch: RegExpExecArray | null;
    while ((pmMatch = pmRegex.exec(folderBlock))) {
      const body = pmMatch[1];
      const name = decodeXml(
        body.match(/<name>([^<]*)<\/name>/i)?.[1] ?? "",
      ).trim();
      const description =
        body.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
      const coordText =
        body.match(/<coordinates>\s*([^<]+)\s*<\/coordinates>/i)?.[1] ?? "";
      const [lngStr, latStr] = coordText.trim().split(/[,\s]+/);
      const lat = Number(latStr);
      const lng = Number(lngStr);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      placemarks.push({
        name,
        description: decodeXml(description),
        coordinates: { lat, lng },
        folder,
      });
    }
  }

  return placemarks;
}

function extractParagraphs(html: string): string[] {
  const paras = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  return paras
    .map((p) => stripTags(p))
    .filter((t) => t.length > 8)
    .filter((t) => !/squarespace|cookie|buy me a coffee/i.test(t));
}

function extractPostcode(text: string): string | null {
  const m = text.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}

function extractWhat3Words(text: string): string | null {
  const labelled = text.match(
    /what\s*3\s*words\s*:?\s*([a-z]+\.[a-z]+\.[a-z]+)/i,
  );
  if (labelled) return labelled[1].toLowerCase();
  const triple = text.match(/\b([a-z]+\.[a-z]+\.[a-z]+)\b/i);
  return triple ? triple[1].toLowerCase() : null;
}

function extractHeroImage(html: string, title: string): {
  url: string | null;
  alt: string | null;
} {
  const imgs =
    html.match(
      /https:\/\/images\.squarespace-cdn\.com\/content\/[^"'\\\s]+/g,
    ) ?? [];
  const preferred = imgs.find(
    (u) =>
      !/favicon|logo|TRE\+|icon/i.test(u) &&
      /\.(jpg|jpeg|png|webp)/i.test(u),
  );
  if (!preferred) {
    const og = html.match(
      /property="og:image"\s+content="([^"]+)"/i,
    )?.[1];
    return { url: og ?? null, alt: title };
  }
  return { url: preferred.split("?")[0] ?? preferred, alt: title };
}

async function enrichFromPage(
  url: string,
  title: string,
): Promise<{
  summary: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  facts: Record<string, string>;
  bodyText: string;
}> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 12 },
  });
  if (!res.ok) {
    throw new Error(`Reluctant Explorers page failed (${res.status})`);
  }
  const html = await res.text();
  const paragraphs = extractParagraphs(html);
  const facts: Record<string, string> = {};
  const labels = [
    "Distance",
    "Terrain",
    "Parking",
    "Public Transport",
    "Dog Friendly?",
    "Location",
    "Map",
    "What 3 Words",
    "Toilets/ Baby Change",
    "Nearest Cafe/ Amenities",
  ];
  for (const label of labels) {
    const re = new RegExp(
      `^${label.replace(/[?*]/g, "\\$&")}\\s*:\\s*(.+)$`,
      "i",
    );
    for (const p of paragraphs) {
      const m = p.match(re);
      if (m) {
        facts[label] = m[1].trim();
        break;
      }
    }
  }

  const ogDesc =
    html.match(
      /property="og:description"\s+content="([^"]+)"/i,
    )?.[1] ?? null;

  // Prefer early walk copy; stop before long direction lists / site chrome.
  const useful = paragraphs.filter(
    (p) =>
      !/^directions to be used/i.test(p) &&
      !/^i set up the reluctant explorers/i.test(p) &&
      !/^scroll using the arrows/i.test(p) &&
      !/^tap here/i.test(p),
  );
  const summary =
    ogDesc ||
    useful.find(
      (p) =>
        p.length > 40 &&
        !/^(distance|terrain|parking|location|map|what 3 words):/i.test(p),
    ) ||
    null;

  const image = extractHeroImage(html, title);
  const factBlob = Object.values(facts).join("\n");
  const leadText = useful.slice(0, 12).join("\n");
  return {
    summary,
    imageUrl: image.url,
    imageAlt: image.alt,
    facts,
    bodyText: [summary, factBlob, leadText].filter(Boolean).join("\n"),
  };
}

function guessCost(text: string): string | null {
  if (/pay and display|parking charge|admission|entry fee|ticket/i.test(text)) {
    const m = text.match(
      /(?:£\d+(?:\.\d{2})?|\bfree\b(?:\s+entry)?|\bno charge\b)[^.!]{0,80}/i,
    );
    if (m) return m[0].trim();
    if (/pay and display/i.test(text)) return "Parking charges may apply";
  }
  if (/\bfree\b/i.test(text) && /walk|parking|entry/i.test(text)) {
    return "Often free (check parking)";
  }
  return null;
}

export async function fetchReluctantExplorers(): Promise<Activity[]> {
  const res = await fetch(RELUCTANT_EXPLORERS_KML_URL, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 6 },
  });
  if (!res.ok) {
    throw new Error(`Reluctant Explorers KML failed (${res.status})`);
  }

  const kml = await res.text();
  const placemarks = parseKml(kml);
  const now = new Date().toISOString();
  const activities: Activity[] = [];

  // Enrich pages with a modest concurrency limit
  const queue = [...placemarks];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const pm = queue.shift();
      if (!pm) break;

      const pageUrl = extractUrl(pm.description);
      if (!pageUrl) continue;
      const slug = pageUrl.split("/").filter(Boolean).pop() ?? "";
      if (MENU_SLUGS.has(slug)) continue;

      const summaryFromMap = stripTags(pm.description)
        .replace(pageUrl, "")
        .trim();

      let enrichment: Awaited<ReturnType<typeof enrichFromPage>> | null = null;
      try {
        enrichment = await enrichFromPage(pageUrl, pm.name);
      } catch {
        enrichment = null;
      }

      const facts = enrichment?.facts ?? {};
      // Only use this walk's own copy for classification — page chrome lists other walks.
      const ownText = [
        enrichment?.summary,
        summaryFromMap,
        facts.Distance,
        facts.Terrain,
        facts.Parking,
        facts["Nearest Cafe/ Amenities"],
        facts.Location,
        facts["Dog Friendly?"],
      ]
        .filter(Boolean)
        .join("\n");
      const terrainInfo = inferTerrain(facts.Terrain ?? null, ownText);
      const features = extractFeatures(pm.name, ownText, pm.folder);
      const w3w = extractWhat3Words(facts["What 3 Words"] ?? "");
      const postcode =
        extractPostcode(facts.Parking ?? "") ||
        extractPostcode(facts.Location ?? "") ||
        extractPostcode(ownText);

      activities.push({
        id: slugId("reluctant-explorers", pm.name, pageUrl),
        source: "reluctant-explorers",
        sourceUrl: pageUrl,
        title: pm.name.replace(/\s+/g, " ").trim(),
        summary:
          enrichment?.summary ||
          summaryFromMap ||
          "Family-friendly walk from The Reluctant Explorers.",
        imageUrl: enrichment?.imageUrl ?? null,
        imageAlt: enrichment?.imageAlt ?? pm.name,
        locationLabel: facts.Location ?? null,
        postcode,
        what3words: w3w,
        coordinates: pm.coordinates,
        parking: facts.Parking ?? null,
        cost: guessCost([facts.Parking, ownText].filter(Boolean).join("\n")),
        distanceMiles: parseDistanceMiles(facts.Distance ?? ownText),
        terrain: terrainInfo.terrain,
        terrainNotes: terrainInfo.notes,
        features,
        categories: [pm.folder].filter(Boolean),
        driveMinutes: null,
        lastSyncedAt: now,
        rawFacts: facts,
      });
    }
  });

  await Promise.all(workers);
  return activities;
}
