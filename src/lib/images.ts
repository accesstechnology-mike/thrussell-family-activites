import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { USER_AGENT } from "./config";
import type { Activity } from "./types";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const CARD_WIDTH = 720;
const DETAIL_WIDTH = 1200;
const CONCURRENCY = 4;

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

/** Download a remote image, resize to card/detail webp, return local public paths. */
export async function cacheRemoteImage(
  remoteUrl: string,
): Promise<{ card: string; detail: string } | null> {
  if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return null;

  const id = mediaId(remoteUrl);
  const cardPath = path.join(MEDIA_DIR, `${id}-card.webp`);
  const detailPath = path.join(MEDIA_DIR, `${id}-detail.webp`);
  const cardUrl = `/media/${id}-card.webp`;
  const detailUrl = `/media/${id}-detail.webp`;

  if ((await exists(cardPath)) && (await exists(detailPath))) {
    return { card: cardUrl, detail: detailUrl };
  }

  try {
    await mkdir(MEDIA_DIR, { recursive: true });
    const res = await fetch(remoteUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 800) return null;

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

/** Look up a place photo from Wikipedia / Wikimedia Commons (live). */
export async function findPlaceImage(
  title: string,
): Promise<{ url: string; alt: string } | null> {
  const cleaned = title
    .replace(/\b(circular|trail|walks?|family|friendly|kids)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 4) return null;

  const wiki = await wikipediaThumbnail(cleaned);
  if (wiki) return wiki;

  const afterColon = cleaned.includes(":")
    ? cleaned.split(":").slice(1).join(" ").trim()
    : null;
  if (afterColon && afterColon !== cleaned) {
    const retry = await wikipediaThumbnail(afterColon);
    if (retry) return retry;
  }

  return commonsSearch(cleaned);
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
    return { url: image, alt: data.title || title };
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
    const page = Object.values(data.query?.pages ?? {})[0];
    const info = page?.imageinfo?.[0];
    const image = info?.thumburl || info?.url;
    if (!image) return null;
    return { url: image, alt: page?.title?.replace(/^File:/, "") || title };
  } catch {
    return null;
  }
}

/** Fill missing photos, then cache every remote image as local webp. */
export async function enrichActivityImages(
  activities: Activity[],
): Promise<Activity[]> {
  await mkdir(MEDIA_DIR, { recursive: true });

  return mapPool(activities, CONCURRENCY, async (activity) => {
    let remote = activity.imageUrl;
    let alt = activity.imageAlt;
    const rawFacts = { ...activity.rawFacts };

    if (remote?.startsWith("/media/")) {
      return activity;
    }

    if (!remote) {
      const found = await findPlaceImage(activity.title);
      if (found) {
        remote = found.url;
        alt = alt || found.alt;
      }
      await sleep(120);
    }

    if (!remote) {
      return { ...activity, imageAlt: alt };
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

    return {
      ...activity,
      imageUrl: remote,
      imageAlt: alt,
      rawFacts,
    };
  });
}

export { detailImageUrl } from "./image-urls";
