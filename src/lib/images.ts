import { createHash } from "node:crypto";
import { access, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { USER_AGENT } from "./config";
import type { Activity } from "./types";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const CARD_WIDTH = 720;
const DETAIL_WIDTH = 1200;
const CONCURRENCY = 1;
const MIN_BYTES = 4_000;
const MIN_CARD_BYTES = 3_000;
const MIN_STDEV = 12;
const FETCH_RETRIES = 5;

function mediaId(sourceUrl: string): string {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** Collapse accidental `//` in the path (common on Duda/CDN og:image URLs). */
export function normalizeImageUrl(raw: string, base?: string): string | null {
  try {
    const absolute = /^https?:\/\//i.test(raw)
      ? raw
      : base
        ? new URL(raw, base).toString()
        : null;
    if (!absolute) return null;
    const u = new URL(absolute);
    u.pathname = u.pathname.replace(/\/{2,}/g, "/");
    return u.toString();
  } catch {
    return null;
  }
}

export function isJunkImageUrl(url: string): boolean {
  if (/\.pdf($|\?)/i.test(url)) return true;
  if (/ChatGPT-Image/i.test(url)) return true;
  if (/tripadvisor|trip-advisor/i.test(url)) return true;
  if (/(?:movie|film|teaser|poster|dvd|bluray)/i.test(url)) return true;
  if (
    /(?:advert|advertisement|warning|weather|notice|flyer|announcement|timetable|strong-?winds?|site-?map|venue-?map|centre-?map|center-?map|-map-|toilet|lavatory|restroom|bathroom|handicap|pumpkin|halloween|incorporated_and_unincorporated|highlighted\.svg|locator)/i.test(
      url,
    )
  ) {
    return true;
  }
  if (/upload\.wikimedia\.org\/wikipedia\/en\//i.test(url)) return true;
  if (
    /(?:^|[/\-_])(?:logo|favicon|sprite|avatar|emoji|icon|badge|award|widget|banner)(?:[.\-_/?]|$)/i.test(
      url,
    ) ||
    /banner\./i.test(url)
  ) {
    return true;
  }
  if (/-(?:16|32|48|64|96|128|160)w\./i.test(url)) return true;
  if (/cropped-cropped-/i.test(url)) return true;
  if (/\/(?:32x32|16x16|48x48|64x64|180x180)\//i.test(url)) return true;
  if (/apple-icon|skbg\d|cropped-icon/i.test(url)) return true;
  return false;
}

/** Event posters / weather notices: flat graphic yellow+red, not a place photo. */
export async function looksLikeGraphicNotice(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf)
    .resize(160, 100, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let warningYellow = 0;
  let graphicRed = 0;
  let graphicOrange = 0;
  let nearWhite = 0;
  let nearBlack = 0;
  let midPhoto = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 225) nearWhite += 1;
    else if (lum < 28) nearBlack += 1;
    else if (sat < 0.45 && lum > 40 && lum < 210) midPhoto += 1;
    if (r > 175 && g > 145 && b < 95 && sat > 0.45) warningYellow += 1;
    if (r > 150 && g < 70 && b < 70) graphicRed += 1;
    if (r > 180 && g > 70 && g < 170 && b < 80 && sat > 0.45) graphicOrange += 1;
  }
  const yellow = warningYellow / n;
  const red = graphicRed / n;
  const orange = graphicOrange / n;
  const white = nearWhite / n;
  const black = nearBlack / n;
  const flat = white + black;
  const photo = midPhoto / n;
  // Dated weather / event posters: yellow warning type on black/white
  // bands, often composited over a real photo (so "photo" can still be high).
  if (yellow > 0.04 && red > 0.025 && (flat > 0.25 || black > 0.12)) return true;
  if (yellow > 0.07 && (red > 0.03 || flat > 0.22)) return true;
  if (yellow > 0.11) return true;
  if (flat > 0.5 && red > 0.05 && photo < 0.25) return true;
  if (white > 0.12 && black > 0.12 && red > 0.03 && yellow > 0.03) return true;
  // Illustrated event flyers: cream/white field, cartoon colour, little photo.
  if (flat > 0.45 && photo < 0.18 && (orange > 0.08 || yellow > 0.05 || red > 0.04)) {
    return true;
  }
  // Wikipedia locator maps and line diagrams: mostly paper + ink, little photo.
  if (flat > 0.7 && photo < 0.18) return true;
  const quant = new Map<number, number>();
  for (let i = 0; i < data.length; i += 3) {
    const key =
      ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
    quant.set(key, (quant.get(key) ?? 0) + 1);
  }
  const topShare = Math.max(...quant.values()) / n;
  // Cartoon logos / clip-art headers: one huge flat fill (e.g. a drawn sky).
  if (topShare > 0.55) return true;
  return false;
}

function isListicleOrAggregatorUrl(url: string): boolean {
  return /muddybootsmummy|alltrails\.com|yorkshiretots|thereluctantexplorers|teessidefamilylife|littlevikings|nationaltrust\.org|english-heritage\.org|walkiees|theoutdoorguide|dogfriendly|where2walk/i.test(
    url,
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, redirect: "follow" });
      if (res.status === 429 || res.status >= 500) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      return res;
    } catch {
      await sleep(400 * 2 ** attempt);
    }
  }
  return null;
}

async function probeImageUrl(url: string): Promise<boolean> {
  const head = await fetchWithRetry(url, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
  });
  if (head?.ok) {
    const type = head.headers.get("content-type") || "";
    const len = Number(head.headers.get("content-length") || "0");
    if (type.startsWith("image/") && (len === 0 || len >= MIN_BYTES)) {
      return true;
    }
    if (type.startsWith("image/") && len > 0 && len < MIN_BYTES) return false;
  }

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "image/*",
      Range: "bytes=0-2047",
    },
  });
  if (!res || !(res.ok || res.status === 206)) return false;
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/") && !type.includes("octet-stream")) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length >= 32;
}

async function isUsefulImageBuffer(buf: Buffer): Promise<boolean> {
  if (buf.length < MIN_BYTES) return false;
  const meta = await sharp(buf).metadata();
  if ((meta.width ?? 0) < 240 || (meta.height ?? 0) < 160) return false;
  if (await looksLikeGraphicNotice(buf)) return false;
  const stats = await sharp(buf).stats();
  const maxStdev = Math.max(...stats.channels.map((c) => c.stdev));
  return maxStdev >= MIN_STDEV;
}

async function localCardIsGood(cardPath: string): Promise<boolean> {
  try {
    const size = (await stat(cardPath)).size;
    if (size < MIN_CARD_BYTES) return false;
    return isUsefulImageBuffer(await sharp(cardPath).toBuffer());
  } catch {
    return false;
  }
}

/** Download a remote image, resize to card/detail webp, return local public paths. */
export async function cacheRemoteImage(
  remoteUrl: string,
): Promise<{ card: string; detail: string } | null> {
  const normalized = normalizeImageUrl(remoteUrl);
  if (!normalized || isJunkImageUrl(normalized)) return null;

  const id = mediaId(normalized);
  const cardPath = path.join(MEDIA_DIR, `${id}-card.webp`);
  const detailPath = path.join(MEDIA_DIR, `${id}-detail.webp`);
  const cardUrl = `/media/${id}-card.webp`;
  const detailUrl = `/media/${id}-detail.webp`;

  if ((await exists(cardPath)) && (await exists(detailPath))) {
    if (await localCardIsGood(cardPath)) {
      return { card: cardUrl, detail: detailUrl };
    }
    await unlink(cardPath).catch(() => undefined);
    await unlink(detailPath).catch(() => undefined);
  }

  try {
    await mkdir(MEDIA_DIR, { recursive: true });
    const res = await fetchWithRetry(normalized, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    });
    if (!res?.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!(await isUsefulImageBuffer(buf))) return null;

    await sharp(buf)
      .rotate()
      .resize({
        width: CARD_WIDTH,
        height: 480,
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 72 })
      .toFile(cardPath);

    await sharp(buf)
      .rotate()
      .resize({ width: DETAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(detailPath);

    if (!(await localCardIsGood(cardPath))) {
      await unlink(cardPath).catch(() => undefined);
      await unlink(detailPath).catch(() => undefined);
      return null;
    }

    return { card: cardUrl, detail: detailUrl };
  } catch {
    return null;
  }
}

function scoreImageCandidate(url: string, title?: string): number {
  let score = 0;
  if (/lirp\.cdn-website\.com/i.test(url)) score += 40;
  if (/irp\.cdn-website\.com/i.test(url)) score += 30;
  if (/upload\.wikimedia\.org/i.test(url)) score += 25;
  if (/wp-content\/uploads/i.test(url)) score += 20;
  const w = url.match(/-(\d{3,4})w\./i)?.[1];
  if (w) score += Math.min(Number(w) / 20, 60);
  if (/-(?:1920|1600|1280|1200|1152|1024)w\./i.test(url)) score += 25;
  if (/\.(?:jpe?g)(?:$|\?)/i.test(url)) score += 8;
  if (/(?:cave|garden|grounds|waterfall|exterior|landscape|view|header)/i.test(url)) {
    score += 35;
  }
  if (/(?:bird|owl|eagle|hawk|falcon|vulture|prey|aviary)/i.test(url)) {
    score += 35;
  }
  if (title) {
    const hay = decodeURIComponent(url).toLowerCase();
    score += titleTokens(title).filter((t) => hay.includes(t)).length * 25;
  }
  if (/(?:food|drink|shop|menu|puppaccino|christmas|elf|dog|-disc)/i.test(url)) {
    score -= 40;
  }
  if (
    /(?:warning|weather|notice|advert|flyer|july|saturday|sunday|calendar|closed|timetable|map|pumpkin|halloween|toilet)/i.test(
      url,
    )
  ) {
    score -= 80;
  }
  if (isJunkImageUrl(url)) score -= 1000;
  return score;
}

const GENERIC_TITLE_TOKENS = new Set([
  "park",
  "parks",
  "wood",
  "woods",
  "forest",
  "nature",
  "reserve",
  "farm",
  "lake",
  "hall",
  "castle",
  "abbey",
  "garden",
  "gardens",
  "common",
  "circular",
  "walk",
  "walks",
  "trail",
  "family",
  "friendly",
  "kids",
  "yorkshire",
  "swimming",
  "pool",
  "lakes",
  "leisure",
  "centre",
  "center",
  "the",
  "and",
  "with",
  "from",
  "near",
]);

const ACTIVITY_TYPE_TOKENS = new Set([
  "accessible",
  "lead",
  "smelting",
  "smelter",
  "mill",
  "mills",
  "quarry",
  "sssi",
  "beach",
  "sands",
  "zoo",
  "aquarium",
  "handicap",
  "toilet",
]);

function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !GENERIC_TITLE_TOKENS.has(t));
}

function titlesRelated(place: string, pageTitle: string): boolean {
  const tokens = titleTokens(place);
  const hay = pageTitle.toLowerCase().replace(/[_-]+/g, " ");
  if (!tokens.length) {
    const norm = place
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return Boolean(norm) && hay.includes(norm);
  }
  const overlap = tokens.filter((t) => hay.includes(t));
  if (overlap.length === 0) return false;
  const distinctive = tokens.filter((t) => !ACTIVITY_TYPE_TOKENS.has(t));
  if (distinctive.length && !distinctive.some((t) => hay.includes(t))) {
    return false;
  }
  // Short place names must match all distinctive tokens (avoids "Ladybird" → beetle).
  if (tokens.length <= 2) {
    return overlap.length === tokens.length && hay.includes(tokens[0]!);
  }
  return overlap.length >= 2;
}

function wikiPageLooksGeographic(pageTitle: string): boolean {
  // Reject obvious non-place Wikipedia targets (species, films, locator maps).
  if (
    /\b(coccinella|species|genus|aquarium|amaterske|septempunctata|movie|film|album|song|novel|incorporated|unincorporated|locator)\b/i.test(
      pageTitle,
    )
  ) {
    return false;
  }
  return true;
}

function placeTitleVariants(title: string): string[] {
  const cleaned = title
    .replace(/\b(circular|trail|walks?|family|friendly|kids|sssi|lnr)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = cleaned
    .replace(/^\s*old\s+/i, "")
    .replace(/\b(yew tree maze|adventure farm(?: park)?|local nature reserve|nature reserve|theme park|farm park|maze)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned
    .split(/\s*(?:,|\/|\band\b|\bto\b)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 4);
  return [
    ...new Set([cleaned, stripped, ...parts].filter((v) => v.length > 4)),
  ].filter((v) => titleTokens(v).length >= 2 || v === cleaned);
}

const SITE_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

const PHOTO_PAGE =
  /\/(?:visitor|about|gallery|meet|bird|animal|what-to-see|our-|photo|display|attraction|explore|plan-your|experience|sponsor)/i;
const SKIP_PAGE =
  /basket|cart|privacy|terms|cookie|login|account|checkout|gift|voucher|donation|policy|wp-content|mailto:|tel:/i;

function extractImageUrlsFromHtml(
  html: string,
  website: string,
  title?: string,
): string[] {
  const raw: string[] = [];

    const metaPatterns = [
      /property=["']og:image(?::secure_url)?["']\s+content=["']([^"']+)["']/gi,
      /content=["']([^"']+)["']\s+property=["']og:image(?::secure_url)?["']/gi,
      /name=["']twitter:image(?::src)?["']\s+content=["']([^"']+)["']/gi,
      /content=["']([^"']+)["']\s+name=["']twitter:image(?::src)?["']/gi,
      /rel=["']image_src["']\s+href=["']([^"']+)["']/gi,
    ];
    for (const re of metaPatterns) {
      for (const m of html.matchAll(re)) {
        if (m[1]) raw.push(m[1]);
      }
    }

    for (const m of html.matchAll(
      /<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/gi,
    )) {
      if (m[1]) raw.push(m[1]);
    }
    for (const m of html.matchAll(
      /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*wp-post-image[^"']*["']/gi,
    )) {
      if (m[1]) raw.push(m[1]);
    }

    for (const m of html.matchAll(
      /https?:\/\/(?:l?irp\.cdn-website\.com|[^"' ]+\/(?:wp-content\/uploads|images|media|dms3rep))\/[^"' \s,]+\.(?:jpe?g|png|webp)/gi,
    )) {
      raw.push(m[0]);
    }

    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const item of raw) {
      const absolute = normalizeImageUrl(item, website);
      if (!absolute || seen.has(absolute) || isJunkImageUrl(absolute)) continue;
      seen.add(absolute);
      candidates.push(absolute);
    }

  candidates.sort(
    (a, b) => scoreImageCandidate(b, title) - scoreImageCandidate(a, title),
  );
  return candidates;
}

function photoPageLinks(html: string, website: string): string[] {
  const origin = new URL(website).origin;
  const links: string[] = [];
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, website);
      if (u.origin !== origin) continue;
      if (SKIP_PAGE.test(u.pathname + u.search)) continue;
      if (!PHOTO_PAGE.test(u.pathname)) continue;
      links.push(u.toString());
    } catch {
      // ignore bad hrefs
    }
  }
  return [...new Set(links)].slice(0, 6);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: SITE_FETCH_HEADERS,
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function collectSiteImageCandidates(
  website: string,
  title?: string,
): Promise<string[]> {
  try {
    const html = await fetchHtml(website);
    if (!html) return [];
    const candidates = extractImageUrlsFromHtml(html, website, title);
    const seen = new Set(candidates);
    for (const page of photoPageLinks(html, website)) {
      await sleep(120);
      const pageHtml = await fetchHtml(page);
      if (!pageHtml) continue;
      for (const url of extractImageUrlsFromHtml(pageHtml, page, title)) {
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push(url);
      }
    }
    candidates.sort(
      (a, b) => scoreImageCandidate(b, title) - scoreImageCandidate(a, title),
    );
    return candidates;
  } catch {
    return [];
  }
}

async function wikipediaThumbnail(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const slug = title.replace(/\s+/g, "_");
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  try {
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res?.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    const image = data.originalimage?.source || data.thumbnail?.source;
    if (!image) return null;
    const normalized = normalizeImageUrl(image);
    if (!normalized) return null;
    return { url: normalized, alt: data.title || title };
  } catch {
    return null;
  }
}

async function wikipediaSearchThumbnail(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const api =
    "https://en.wikipedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: title,
      srlimit: "5",
      format: "json",
      origin: "*",
    });
  try {
    const res = await fetchWithRetry(api, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res?.ok) return null;
    const data = (await res.json()) as {
      query?: { search?: Array<{ title?: string }> };
    };
    for (const hit of data.query?.search ?? []) {
      if (!hit.title || !titlesRelated(title, hit.title)) continue;
      const thumb = await wikipediaThumbnail(hit.title);
      if (thumb) return thumb;
      await sleep(80);
    }
    return null;
  } catch {
    return null;
  }
}

async function commonsSearch(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const api =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `${title} Yorkshire`,
      gsrlimit: "5",
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "1200",
      format: "json",
      origin: "*",
    });
  try {
    const res = await fetchWithRetry(api, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res?.ok) return null;
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{ thumburl?: string; url?: string }>;
          }
        >;
      };
    };
    const pages = Object.values(data.query?.pages ?? {});
    const tokens = titleTokens(title);

    const ranked = pages
      .map((page) => {
        const fileTitle = page?.title?.replace(/^File:/, "") || "";
        const hay = fileTitle.toLowerCase();
        const overlap = tokens.filter((t) => hay.includes(t)).length;
        return { page, fileTitle, overlap };
      })
      .filter((x) => !/\.pdf/i.test(x.fileTitle))
      .sort((a, b) => b.overlap - a.overlap);

    for (const item of ranked) {
      if (!titlesRelated(title, item.fileTitle)) continue;
      const info = item.page?.imageinfo?.[0];
      const image = info?.thumburl || info?.url;
      if (!image || /\.pdf($|\?)/i.test(image)) continue;
      const normalized = normalizeImageUrl(image);
      if (!normalized) continue;
      return { url: normalized, alt: item.fileTitle || title };
    }
    return null;
  } catch {
    return null;
  }
}

async function collectPlaceImageCandidates(
  title: string,
  opts?: { website?: string | null; prefer?: string | null },
): Promise<string[]> {
  const variants = placeTitleVariants(title);
  if (!variants.length) return [];

  const tiered: string[] = [];
  const push = (url: string | null | undefined) => {
    const n = url ? normalizeImageUrl(url) : null;
    if (n && !isJunkImageUrl(n)) tiered.push(n);
  };

  // Keep venue-site photos ahead of Wikipedia so we don't attach the wrong place.
  push(opts?.prefer ?? null);

  if (
    opts?.website &&
    /^https?:\/\//i.test(opts.website) &&
    !isListicleOrAggregatorUrl(opts.website)
  ) {
    tiered.push(...(await collectSiteImageCandidates(opts.website, title)));
  }

  // Skip Wikipedia for ultra-short titles — those searches latch onto species /
  // common nouns ("Ladybird", "Aquarium") instead of places.
  const allowWiki = titleTokens(variants[0] || title).length >= 2;

  if (allowWiki) {
    for (const variant of variants.slice(0, 4)) {
      if (titleTokens(variant).length < 2) continue;
      const wikiExact = await wikipediaThumbnail(variant);
      if (
        wikiExact &&
        titlesRelated(variant, wikiExact.alt || variant) &&
        wikiPageLooksGeographic(wikiExact.alt || "")
      ) {
        push(wikiExact.url);
      } else {
        const searched = await wikipediaSearchThumbnail(variant);
        if (
          searched &&
          titlesRelated(variant, searched.alt || variant) &&
          wikiPageLooksGeographic(searched.alt || "")
        ) {
          push(searched.url);
        }
      }

      const commons = await commonsSearch(variant);
      if (commons && titlesRelated(variant, commons.alt || variant)) {
        push(commons.url);
      }
      await sleep(80);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of tiered) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

/** Look up a place photo from Wikipedia / Wikimedia Commons / site images. */
export async function findPlaceImage(
  title: string,
  opts?: { website?: string | null; prefer?: string | null },
): Promise<{ url: string; alt: string } | null> {
  const candidates = await collectPlaceImageCandidates(title, opts);
  for (const url of candidates) {
    if (await probeImageUrl(url)) return { url, alt: title };
  }
  return null;
}

function remoteLooksRelated(title: string, url: string): boolean {
  if (!/wikimedia|wikipedia/i.test(url)) return true;
  try {
    const leaf = decodeURIComponent(new URL(url).pathname);
    return titlesRelated(title, leaf);
  } catch {
    return false;
  }
}

function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /openstreetmap\.org/i.test(trimmed)) return null;
  if (isListicleOrAggregatorUrl(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function activityWebsite(activity: Activity): string | null {
  return (
    normalizeWebsite(activity.sourceUrl) ||
    normalizeWebsite(
      typeof activity.rawFacts?.website === "string"
        ? activity.rawFacts.website
        : null,
    )
  );
}

function osmLookupId(osmType: string, osmId: string): string | null {
  const prefix =
    osmType === "relation" || osmType === "r"
      ? "R"
      : osmType === "way" || osmType === "w"
        ? "W"
        : osmType === "node" || osmType === "n"
          ? "N"
          : null;
  if (!prefix || !/^\d+$/.test(osmId)) return null;
  return `${prefix}${osmId}`;
}

function parseWikipediaTag(tag: string): string | null {
  const trimmed = tag.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(?:[a-z]{2,3}:)?(.+)$/i);
  const title = m?.[1]?.replace(/_/g, " ").trim();
  return title && title.length > 2 ? title : null;
}

function commonsFileUrl(fileTitle: string): string | null {
  const name = fileTitle.replace(/^File:/i, "").trim();
  if (!name || /\.pdf($|\?)/i.test(name) || /^Category:/i.test(fileTitle)) {
    return null;
  }
  return normalizeImageUrl(
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=1280`,
  );
}

async function wikidataP18Url(qid: string): Promise<string | null> {
  const id = qid.trim();
  if (!/^Q\d+$/i.test(id)) return null;
  const url =
    "https://www.wikidata.org/w/api.php?" +
    new URLSearchParams({
      action: "wbgetclaims",
      entity: id,
      property: "P18",
      format: "json",
      origin: "*",
    });
  try {
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res?.ok) return null;
    const data = (await res.json()) as {
      claims?: {
        P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>;
      };
    };
    const file = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    return file ? commonsFileUrl(file) : null;
  } catch {
    return null;
  }
}

async function nominatimOsmExtratags(
  osmType: string,
  osmId: string,
): Promise<Record<string, string>> {
  const osm = osmLookupId(osmType, osmId);
  if (!osm) return {};
  const url =
    "https://nominatim.openstreetmap.org/lookup?" +
    new URLSearchParams({
      osm_ids: osm,
      format: "json",
      extratags: "1",
    });
  try {
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    await sleep(1100);
    if (!res?.ok) return {};
    const rows = (await res.json()) as Array<{
      extratags?: Record<string, string>;
    }>;
    return rows[0]?.extratags ?? {};
  } catch {
    return {};
  }
}

async function withOsmImageTags(activity: Activity): Promise<Activity> {
  if (
    activity.rawFacts.wikidata ||
    activity.rawFacts.wikipedia ||
    activity.rawFacts.wikimediaCommons
  ) {
    return activity;
  }
  const osmType = activity.rawFacts.osmType;
  const osmId = activity.rawFacts.osmId;
  if (!osmType || !osmId) return activity;

  const extra = await nominatimOsmExtratags(osmType, osmId);
  const rawFacts = { ...activity.rawFacts };
  if (extra.wikidata) rawFacts.wikidata = extra.wikidata;
  if (extra.wikipedia) rawFacts.wikipedia = extra.wikipedia;
  if (extra.wikimedia_commons) rawFacts.wikimediaCommons = extra.wikimedia_commons;
  if (extra.website && !rawFacts.website) rawFacts.website = extra.website;
  return { ...activity, rawFacts };
}

async function collectOsmTaggedImageCandidates(
  activity: Activity,
): Promise<string[]> {
  const urls: string[] = [];
  const push = (url: string | null | undefined) => {
    const n = url ? normalizeImageUrl(url) : null;
    if (n && !isJunkImageUrl(n)) urls.push(n);
  };

  if (typeof activity.rawFacts.wikidata === "string") {
    push(await wikidataP18Url(activity.rawFacts.wikidata));
  }
  if (typeof activity.rawFacts.wikimediaCommons === "string") {
    push(commonsFileUrl(activity.rawFacts.wikimediaCommons));
  }
  if (typeof activity.rawFacts.wikipedia === "string") {
    const page = parseWikipediaTag(activity.rawFacts.wikipedia);
    if (page) {
      const thumb = await wikipediaThumbnail(page);
      if (thumb && titlesRelated(page, thumb.alt || page)) push(thumb.url);
    }
  }

  const seen = new Set<string>();
  return urls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

function isOsmBacked(activity: Activity): boolean {
  return (
    activity.source === "openstreetmap" ||
    Boolean(activity.rawFacts?.osmId)
  );
}

async function tryCacheCandidates(
  candidates: string[],
): Promise<{ remote: string; card: string; detail: string } | null> {
  for (const remote of candidates) {
    const cached = await cacheRemoteImage(remote);
    if (cached) return { remote, ...cached };
    await sleep(120);
  }
  return null;
}

/** Fill missing photos, then cache every remote image as local webp. */
export async function enrichActivityImages(
  activities: Activity[],
): Promise<Activity[]> {
  await mkdir(MEDIA_DIR, { recursive: true });

  return mapPool(activities, CONCURRENCY, async (activity) => {
    let alt = activity.imageAlt;
    const rawFacts = { ...activity.rawFacts };
    const current = activity.imageUrl;

    const priorIsJunk =
      typeof rawFacts.imageRemote === "string" &&
      (isJunkImageUrl(rawFacts.imageRemote) ||
        !remoteLooksRelated(activity.title, rawFacts.imageRemote));
    if (current?.startsWith("/media/") && !priorIsJunk) {
      const file = path.join(MEDIA_DIR, path.basename(current));
      if ((await exists(file)) && (await localCardIsGood(file))) {
        return activity;
      }
    }

    let working = activity;
    if (isOsmBacked(working)) {
      working = await withOsmImageTags({ ...working, rawFacts });
      Object.assign(rawFacts, working.rawFacts);
    }

    const website = activityWebsite({ ...working, rawFacts });
    const priorRaw =
      (current && !current.startsWith("/") ? current : null) ||
      (typeof rawFacts.imageRemote === "string" ? rawFacts.imageRemote : null);
    const priorRemote =
      priorRaw &&
      remoteLooksRelated(working.title, priorRaw) &&
      !isJunkImageUrl(priorRaw)
        ? priorRaw
        : null;

    let candidates: string[] = [];
    if (isOsmBacked(working)) {
      const osmTagged = await collectOsmTaggedImageCandidates({
        ...working,
        rawFacts,
      });
      const site = website
        ? await collectSiteImageCandidates(website, working.title)
        : [];
      const wiki =
        titleTokens(working.title).length >= 2
          ? await collectPlaceImageCandidates(working.title, {
              website: null,
              prefer: null,
            })
          : [];
      const seen = new Set<string>();
      for (const url of [...site, ...osmTagged, ...wiki, priorRemote]) {
        if (!url || seen.has(url) || isJunkImageUrl(url)) continue;
        seen.add(url);
        candidates.push(url);
      }
    } else {
      candidates = await collectPlaceImageCandidates(working.title, {
        website,
        prefer: priorRemote,
      });
    }

    await sleep(150);
    const cached = await tryCacheCandidates(candidates);
    if (cached) {
      rawFacts.imageRemote = cached.remote;
      rawFacts.imageDetail = cached.detail;
      return {
        ...activity,
        imageUrl: cached.card,
        imageAlt: alt || activity.title,
        rawFacts,
      };
    }

    if (current?.startsWith("/media/") && !priorIsJunk) {
      const file = path.join(MEDIA_DIR, path.basename(current));
      if ((await exists(file)) && (await localCardIsGood(file))) {
        return activity;
      }
    }

    delete rawFacts.imageRemote;
    delete rawFacts.imageDetail;
    return {
      ...activity,
      imageUrl: null,
      imageAlt: alt,
      rawFacts,
    };
  });
}

export async function activityImageNeedsRefresh(
  activity: Activity,
): Promise<boolean> {
  const remote =
    typeof activity.rawFacts?.imageRemote === "string"
      ? activity.rawFacts.imageRemote
      : null;
  if (remote && isJunkImageUrl(remote)) return true;
  if (remote && !remoteLooksRelated(activity.title, remote)) return true;
  if (!activity.imageUrl) return true;
  if (!activity.imageUrl.startsWith("/media/")) return true;
  const file = path.join(MEDIA_DIR, path.basename(activity.imageUrl));
  if (!(await exists(file))) return true;
  return !(await localCardIsGood(file));
}

export { detailImageUrl } from "./image-urls";
