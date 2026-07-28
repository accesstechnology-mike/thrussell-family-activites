import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { USER_AGENT } from "./config";
import type { Activity } from "./types";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const CARD_WIDTH = 720;
const DETAIL_WIDTH = 1200;
const CONCURRENCY = 2;
const MIN_BYTES = 4_000;
const FETCH_RETRIES = 4;

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

function isJunkImageUrl(url: string): boolean {
  if (/\.pdf($|\?)/i.test(url)) return true;
  if (/ChatGPT-Image/i.test(url)) return true;
  if (
    /(?:^|[/\-_])(?:logo|favicon|sprite|avatar|emoji|icon|badge|tripadvisor|award|widget)(?:[.\-_/?]|$)/i.test(
      url,
    )
  ) {
    return true;
  }
  // Tiny responsive variants / cropped favicons
  if (/-(?:16|32|48|64|96|128|160)w\./i.test(url)) return true;
  if (/cropped-cropped-/i.test(url)) return true;
  if (/\/(?:32x32|16x16|48x48|64x64)\//i.test(url)) return true;
  return false;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, redirect: "follow" });
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return res;
    } catch {
      await sleep(300 * 2 ** attempt);
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

  // Lightweight GET — avoid downloading full images just to probe.
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
    return { card: cardUrl, detail: detailUrl };
  }

  try {
    await mkdir(MEDIA_DIR, { recursive: true });
    const res = await fetchWithRetry(normalized, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    });
    if (!res?.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES) return null;

    const meta = await sharp(buf).metadata();
    if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 150) return null;

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

    return { card: cardUrl, detail: detailUrl };
  } catch {
    return null;
  }
}

function scoreImageCandidate(url: string): number {
  let score = 0;
  if (/lirp\.cdn-website\.com/i.test(url)) score += 40;
  if (/irp\.cdn-website\.com/i.test(url)) score += 30;
  if (/upload\.wikimedia\.org/i.test(url)) score += 25;
  if (/wp-content\/uploads/i.test(url)) score += 20;
  if (/og:|twitter/i.test(url)) score += 5;
  const w = url.match(/-(\d{3,4})w\./i)?.[1];
  if (w) score += Math.min(Number(w) / 20, 60);
  if (/-(?:1920|1600|1280|1200|1152|1024)w\./i.test(url)) score += 25;
  if (isJunkImageUrl(url)) score -= 1000;
  return score;
}

async function collectSiteImageCandidates(website: string): Promise<string[]> {
  try {
    const res = await fetch(website, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; thrussell-family-activities/1.0; +local family app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
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
      /https?:\/\/(?:l?irp\.cdn-website\.com|[^"' ]+\/(?:wp-content\/uploads|images|media|dms3rep))\/[^"' ]+\.(?:jpe?g|png|webp)/gi,
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

    candidates.sort((a, b) => scoreImageCandidate(b) - scoreImageCandidate(a));
    return candidates;
  } catch {
    return [];
  }
}

async function firstWorkingImage(
  candidates: string[],
): Promise<string | null> {
  for (const url of candidates) {
    if (isJunkImageUrl(url)) continue;
    if (await probeImageUrl(url)) return url;
  }
  return null;
}

/** Look up a place photo from Wikipedia / Wikimedia Commons / site images. */
export async function findPlaceImage(
  title: string,
  opts?: { website?: string | null; prefer?: string | null },
): Promise<{ url: string; alt: string } | null> {
  const cleaned = title
    .replace(/\b(circular|trail|walks?|family|friendly|kids)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 4) return null;

  const candidates: string[] = [];
  if (opts?.prefer) {
    const n = normalizeImageUrl(opts.prefer);
    if (n) candidates.push(n);
  }

  if (opts?.website && /^https?:\/\//i.test(opts.website)) {
    candidates.push(...(await collectSiteImageCandidates(opts.website)));
  }

  const wiki = await wikipediaThumbnail(cleaned);
  if (wiki) candidates.push(wiki.url);

  const afterColon = cleaned.includes(":")
    ? cleaned.split(":").slice(1).join(" ").trim()
    : null;
  if (afterColon && afterColon !== cleaned) {
    const retry = await wikipediaThumbnail(afterColon);
    if (retry) candidates.push(retry.url);
  }

  const commons = await commonsSearch(cleaned);
  if (commons) candidates.push(commons.url);

  const url = await firstWorkingImage(candidates);
  if (!url) return null;
  return { url, alt: title };
}

async function wikipediaThumbnail(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const slug = title.replace(/\s+/g, "_");
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
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

async function commonsSearch(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const api =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `${title} Yorkshire`,
      gsrlimit: "1",
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "1200",
      format: "json",
      origin: "*",
    });
  try {
    const res = await fetch(api, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
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
    for (const page of pages) {
      const fileTitle = page?.title?.replace(/^File:/, "") || "";
      if (/\.pdf/i.test(fileTitle)) continue;
      const tokens = title
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 3)
        .slice(0, 3);
      const hay = fileTitle.toLowerCase();
      const overlap = tokens.filter((t) => hay.includes(t)).length;
      if (tokens.length && overlap === 0) continue;
      const info = page?.imageinfo?.[0];
      const image = info?.thumburl || info?.url;
      if (!image || /\.pdf($|\?)/i.test(image)) continue;
      const normalized = normalizeImageUrl(image);
      if (!normalized) continue;
      return { url: normalized, alt: fileTitle || title };
    }
    return null;
  } catch {
    return null;
  }
}

function activityWebsite(activity: Activity): string | null {
  if (
    activity.sourceUrl &&
    /^https?:\/\//i.test(activity.sourceUrl) &&
    !/openstreetmap\.org/i.test(activity.sourceUrl)
  ) {
    return activity.sourceUrl;
  }
  const fromFacts = activity.rawFacts?.website;
  if (typeof fromFacts === "string" && /^https?:\/\//i.test(fromFacts)) {
    return fromFacts;
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

    if (current?.startsWith("/media/")) {
      const file = path.join(MEDIA_DIR, path.basename(current));
      if (await exists(file)) return activity;
    }

    const website = activityWebsite(activity);
    const priorRemote =
      (current && !current.startsWith("/") ? current : null) ||
      (typeof rawFacts.imageRemote === "string" ? rawFacts.imageRemote : null);

    let remote: string | null = priorRemote
      ? normalizeImageUrl(priorRemote)
      : null;

    // Prefer validating the existing remote; if dead/junk, scrape site + wiki.
    if (remote && (isJunkImageUrl(remote) || !(await probeImageUrl(remote)))) {
      remote = null;
    }

    if (!remote) {
      const found = await findPlaceImage(activity.title, {
        website,
        prefer: priorRemote,
      });
      if (found) {
        remote = found.url;
        alt = alt || found.alt;
      }
      await sleep(200);
    }

    if (!remote) {
      delete rawFacts.imageRemote;
      delete rawFacts.imageDetail;
      return {
        ...activity,
        imageUrl: null,
        imageAlt: alt,
        rawFacts,
      };
    }

    rawFacts.imageRemote = remote;
    const cached = await cacheRemoteImage(remote);
    if (cached) {
      rawFacts.imageDetail = cached.detail;
      return {
        ...activity,
        imageUrl: cached.card,
        imageAlt: alt,
        rawFacts,
      };
    }

    // Keep a verified-live remote if local cache fails (e.g. transient CDN errors).
    // Never keep URLs that fail probing — those become blank.
    if (await probeImageUrl(remote)) {
      delete rawFacts.imageDetail;
      return {
        ...activity,
        imageUrl: remote,
        imageAlt: alt,
        rawFacts,
      };
    }

    delete rawFacts.imageDetail;
    return {
      ...activity,
      imageUrl: null,
      imageAlt: alt,
      rawFacts,
    };
  });
}

export { detailImageUrl } from "./image-urls";
