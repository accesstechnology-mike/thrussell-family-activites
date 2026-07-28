import { fetchPageWithBrowser } from "../browser-fetch";
import { itemsToActivities, type ListicleItem } from "./listicle";
import type { Activity } from "../types";

const SOURCE_URL =
  "https://muddybootsmummy.co.uk/family-friendly-walks-in-yorkshire/";
const CACHE_KEY = "muddy-boots-mummy-yorkshire-walks";

/**
 * Muddy Boots Mummy Yorkshire family walks roundup.
 * Cloudflare often blocks plain HTTP; Playwright + local source-cache fallback.
 */
export async function fetchMuddyBootsMummy(): Promise<Activity[]> {
  const page = await fetchPageWithBrowser({
    url: SOURCE_URL,
    cacheKey: CACHE_KEY,
    waitMs: 4000,
  });
  const items = parseMuddyBoots(page.text);
  return itemsToActivities(items, {
    source: "muddy-boots-mummy",
    sourceUrl: SOURCE_URL,
    category: "Muddy Boots Mummy",
    regionSuffix: "Yorkshire",
  });
}

function parseMuddyBoots(text: string): ListicleItem[] {
  const items: ListicleItem[] = [];
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Prefer explicit place lines that look like outing blurbs.
  const placeLine =
    /^([A-Z][\w'’&()-]*(?:\s+[A-Z][\w'’&()-]*){0,6})(?:,\s*([A-Z]{1,2}\d{1,2}[A-Z]?(?:\s*\d[A-Z]{2})?))?\s+(.{40,})$/;

  for (const line of lines) {
    if (/^family walks in /i.test(line)) continue;
    if (/^navigate to walks/i.test(line)) continue;
    if (/^these yorkshire walks/i.test(line)) continue;
    if (/^olaf and stickman/i.test(line)) continue;
    if (/^hide and seek/i.test(line)) continue;
    if (/^walking the perimeter/i.test(line)) continue;
    if (/^buggy friendly paths/i.test(line)) continue;
    if (/^the treehouse/i.test(line)) continue;
    if (/^for my favourite/i.test(line)) continue;

    const m = line.match(placeLine);
    if (m) {
      items.push({
        title: m[1].trim(),
        postcodeHint: m[2] ? m[2].toUpperCase().replace(/\s+/, " ") : null,
        summary: m[3].trim(),
      });
      continue;
    }

    // Fallback: "Place Name is/has/provides ..."
    const m2 = line.match(
      /^([A-Z][\w'’&()-]*(?:\s+[A-Z][\w'’&()-]*){0,7})\s+(?:is|has|provides|was|sits|comes)\b(.{30,})$/,
    );
    if (m2) {
      items.push({
        title: m2[1].trim(),
        summary: line,
      });
      continue;
    }

    // "Yeadon Tarn. A walk around..."
    const m3 = line.match(
      /^([A-Z][\w'’&()-]*(?:\s+[A-Z][\w'’&()-]*){0,6})\.\s+(.{40,})$/,
    );
    if (m3) {
      items.push({
        title: m3[1].trim(),
        summary: m3[2].trim(),
      });
    }
  }

  // Deduplicate within page by title
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
