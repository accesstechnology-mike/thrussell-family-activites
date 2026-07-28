import { fetchPageWithBrowser } from "../browser-fetch";
import { itemsToActivities, type ListicleItem } from "./listicle";
import type { Activity } from "../types";

const SOURCE_URL =
  "https://muddybootsmummy.co.uk/family-friendly-walks-in-yorkshire/";
const CACHE_KEY = "muddy-boots-mummy-yorkshire-walks";

/** Capitalised place phrase, allowing "and" / "to" connectors. */
const PLACE =
  "([A-Z][\\w'’&()-]*(?:\\s+(?:(?:and|to|&)\\s+)?[A-Z][\\w'’&()-]*){0,8})";

const TITLE_STOPWORDS = new Set(
  [
    "with",
    "not",
    "one",
    "starting",
    "for",
    "the",
    "this",
    "these",
    "also",
    "adjacent",
    "until",
    "there",
    "if",
    "when",
    "after",
    "before",
    "from",
    "into",
    "over",
    "under",
    "just",
    "many",
    "lots",
    "look",
    "finish",
    "add",
    "jump",
    "make",
    "try",
    "read",
    "visit",
    "enjoy",
    "hide",
    "olaf",
    "walking",
    "buggy",
    "family",
    "elsewhere",
    "navigate",
    "i",
  ].map((s) => s.toLowerCase()),
);

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

  // Postcode form is unambiguous: "Woodlesford Lock, LS26 There are…"
  const placeWithPostcode = new RegExp(
    `^${PLACE},\\s*([A-Z]{1,2}\\d{1,2}[A-Z]?(?:\\s*\\d[A-Z]{2})?)\\s+(.{40,})$`,
  );
  const mComma = new RegExp(
    `^${PLACE},\\s+(?![A-Z]{1,2}\\d)(.{40,})$`,
  );
  const mVerb = new RegExp(
    `^${PLACE}\\s+(?:(?:in|near|between|outside|from|at)\\s+[\\w'’&(),\\s-]{0,40}?)?(?:is|has|provides|was|sits|sitting|comes|combines|also\\s+has)\\b(.{30,})$`,
  );
  const mDot = new RegExp(`^${PLACE}\\.\\s+(.{40,})$`);
  const mParen = new RegExp(`^${PLACE}\\([^)]{0,40}\\)\\s*(.{30,})$`);
  const mPossessive = new RegExp(`^${PLACE}'s\\s+(.{40,})$`);

  for (const line of lines) {
    if (/^family walks in /i.test(line)) continue;
    if (/^navigate to walks/i.test(line)) continue;
    if (/^these yorkshire walks/i.test(line)) continue;
    if (/^## /.test(line)) continue;
    if (/^[-*]/.test(line)) continue;

    let matched: ListicleItem | null = null;

    const m = line.match(placeWithPostcode);
    if (m && isPlausibleTitle(m[1])) {
      matched = {
        title: cleanTitle(m[1]),
        postcodeHint: m[2]!.toUpperCase().replace(/\s+/, " "),
        summary: m[3].trim(),
      };
    }

    if (!matched) {
      const c = line.match(mComma);
      if (c && isPlausibleTitle(c[1])) {
        matched = { title: cleanTitle(c[1]), summary: c[2].trim() };
      }
    }

    if (!matched) {
      const v = line.match(mVerb);
      if (v && isPlausibleTitle(v[1])) {
        matched = { title: cleanTitle(v[1]), summary: line };
      }
    }

    if (!matched) {
      const d = line.match(mDot);
      if (d && isPlausibleTitle(d[1])) {
        matched = { title: cleanTitle(d[1]), summary: d[2].trim() };
      }
    }

    if (!matched) {
      const p = line.match(mParen);
      if (p && isPlausibleTitle(p[1])) {
        matched = { title: cleanTitle(p[1]), summary: p[2].trim() };
      }
    }

    if (!matched) {
      const poss = line.match(mPossessive);
      if (poss && isPlausibleTitle(poss[1])) {
        matched = { title: cleanTitle(poss[1]), summary: poss[2].trim() };
      }
    }

    if (matched) items.push(matched);
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanTitle(title: string): string {
  return title
    .replace(/^the\s+/i, "")
    .replace(/'s$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 6) return false;
  const words = t.split(/\s+/).filter((w) => !/^(and|to|&)$/i.test(w));
  // Prefer multi-word place names; allow longer single tokens (Nostell, Ilkley).
  if (words.length < 2 && t.length < 7) return false;
  if (words.length === 1 && TITLE_STOPWORDS.has(words[0]!.toLowerCase())) {
    return false;
  }
  if (TITLE_STOPWORDS.has(words[0]!.toLowerCase()) && words.length < 3) {
    return false;
  }
  if (
    /^(starting|walking|buggy|hide|olaf|for my|until|adjacent|also at|if you)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return true;
}
