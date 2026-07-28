import { fetchPageWithBrowser } from "../browser-fetch";
import { itemsToActivities, type ListicleItem } from "./listicle";
import type { Activity } from "../types";

const SOURCE_URL =
  "https://little-vikings.co.uk/best-family-walks-york-yorkshire-kids/";
const CACHE_KEY = "little-vikings-family-walks";

export async function fetchLittleVikings(): Promise<Activity[]> {
  const page = await fetchPageWithBrowser({
    url: SOURCE_URL,
    cacheKey: CACHE_KEY,
    waitMs: 2000,
  });
  const items = parseLittleVikings(page.text, page.html);
  return itemsToActivities(items, {
    source: "little-vikings",
    sourceUrl: SOURCE_URL,
    category: "Little Vikings",
    regionSuffix: "York, Yorkshire",
  });
}

function parseLittleVikings(text: string, html: string): ListicleItem[] {
  const items: ListicleItem[] = [];

  // Headings in rendered text often appear as their own lines after section titles.
  const blocks = text.split(/\n(?=###\s+|\n(?=[A-Z][^\n]{8,80}\n))/);

  // More reliable: pull h2/h3 from HTML when present.
  const headingMatches = [
    ...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi),
  ];
  if (headingMatches.length) {
    for (let i = 0; i < headingMatches.length; i++) {
      const title = stripTags(headingMatches[i][1])
        .replace(/\s+/g, " ")
        .trim();
      if (!isWalkHeading(title)) continue;
      const after = html.slice(
        (headingMatches[i].index ?? 0) + headingMatches[i][0].length,
      );
      const nextHeading = after.search(/<h[23][^>]*>/i);
      const section = nextHeading >= 0 ? after.slice(0, nextHeading) : after.slice(0, 2500);
      const summary = stripTags(section).replace(/\s+/g, " ").trim().slice(0, 700);
      const img =
        section.match(/<img[^>]+src="([^"]+)"/i)?.[1] ??
        null;
      const postcode = summary.match(
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/,
      )?.[1];
      items.push({
        title: cleanHeading(title),
        summary,
        postcodeHint: postcode ?? null,
        imageUrl: img,
      });
    }
  }

  if (items.length) return dedupeItems(items);

  // Text fallback
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isWalkHeading(line) && !/^walk |^a (flat |riverside |circular )/i.test(line)) {
      continue;
    }
    const summary = lines.slice(i + 1, i + 6).join(" ").slice(0, 700);
    items.push({ title: cleanHeading(line), summary });
  }
  return dedupeItems(items);
}

function isWalkHeading(title: string): boolean {
  const t = title.toLowerCase();
  if (t.length < 8 || t.length > 90) return false;
  if (/recommended|best free|rainy days|harry potter|places to stay|unusual things|subscribe|like this article|basket|are you in|short walks in the glorious/i.test(t)) {
    return false;
  }
  if (/^the best family walks/i.test(t)) return false;
  return /\b(walk|trail|walls|park|forest|abbey|bog|foss|bank|wood|hall|rocks|ings|knavesmire|solar system|dales|nidderdale|malton|bolton|castle howard|sutton|dalby|fountains|beningbrough|askham|moorlands|falling|brimham)\b/i.test(
    t,
  );
}

function cleanHeading(title: string): string {
  return title
    .replace(/^the best family walks.*/i, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeItems(items: ListicleItem[]): ListicleItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
