import { fetchPageWithBrowser } from "../browser-fetch";
import { itemsToActivities, type ListicleItem } from "./listicle";
import type { Activity } from "../types";

const SOURCE_URL =
  "https://www.alltrails.com/en-gb/england/north-yorkshire/kids";
const CACHE_KEY = "alltrails-north-yorkshire-kids";

/**
 * AllTrails North Yorkshire child-friendly trails.
 * Often Cloudflare-blocked; uses Playwright with local source-cache fallback.
 */
export async function fetchAllTrailsKids(): Promise<Activity[]> {
  const page = await fetchPageWithBrowser({
    url: SOURCE_URL,
    cacheKey: CACHE_KEY,
    waitMs: 5000,
  });
  const items = parseAllTrails(page.text);
  return itemsToActivities(items, {
    source: "alltrails",
    sourceUrl: SOURCE_URL,
    category: "AllTrails Kids",
    regionSuffix: "North Yorkshire",
  });
}

function parseAllTrails(text: string): ListicleItem[] {
  const items: ListicleItem[] = [];
  const numbered = [...text.matchAll(/^#(\d+)\s*-\s*(.+)$/gm)];

  for (let i = 0; i < numbered.length; i++) {
    const match = numbered[i]!;
    const title = match[2].trim();
    if (title.length < 4) continue;

    const start = match.index! + match[0].length;
    const end = i + 1 < numbered.length ? numbered[i + 1]!.index! : text.length;
    const body = text.slice(start, end).trim();
    const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const meta = lines[0] ?? "";
    const summary = lines
      .slice(meta && /km|Easy|Moderate|Hard|mi|Length/i.test(meta) ? 1 : 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);
    const distance =
      meta.match(/([\d.]+)\s*km/i)?.[0] ??
      body.match(/Length:\s*([\d.]+)\s*(mi|km)/i)?.[0] ??
      null;
    const difficulty = meta.match(/\b(Easy|Moderate|Hard)\b/i)?.[1] ?? null;
    const postcode = `${meta}\n${summary}`.match(
      /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/,
    )?.[1];
    items.push({
      title,
      summary:
        summary ||
        `${difficulty ?? "Trail"}${meta ? ` · ${meta}` : ""}`.trim(),
      distanceHint: distance,
      terrainHint: difficulty,
      postcodeHint: postcode ?? null,
    });
  }

  // "More child-friendly trails" bullet list
  const moreSection = text.split(/More child-friendly trails/i)[1] ?? "";
  const moreItems = moreSection
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 4 &&
        l.length < 90 &&
        !/^(activities|attractions|suitability|points of interest|top parks|top cities|### )/i.test(
          l,
        ),
    );

  for (const title of moreItems.slice(0, 30)) {
    if (items.some((i) => i.title.toLowerCase() === title.toLowerCase())) {
      continue;
    }
    if (/^(backpacking|bike touring|beach trails)/i.test(title)) break;
    items.push({
      title,
      summary: `Child-friendly trail in North Yorkshire on AllTrails: ${title}`,
    });
  }

  return items;
}
