import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FetchedPage = {
  url: string;
  html: string;
  text: string;
  fromCache: boolean;
  fetchedAt: string;
};

function cachePath(key: string): string {
  return path.join(process.cwd(), "data", "source-cache", `${key}.html`);
}

function metaPath(key: string): string {
  return path.join(process.cwd(), "data", "source-cache", `${key}.meta.json`);
}

function isChallengePage(title: string, html: string, text: string): boolean {
  if (/just a moment|attention required|bot verification/i.test(title)) {
    return true;
  }
  if (html.length < 5000 && /cf-browser-verification|challenge-platform/i.test(html)) {
    return true;
  }
  if (text.trim().length < 400 && /enable javascript|checking your browser/i.test(text)) {
    return true;
  }
  return false;
}

async function saveCache(
  key: string,
  url: string,
  html: string,
): Promise<void> {
  const dir = path.dirname(cachePath(key));
  await mkdir(dir, { recursive: true });
  await writeFile(cachePath(key), html, "utf8");
  await writeFile(
    metaPath(key),
    `${JSON.stringify({ url, fetchedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

async function loadCache(key: string, url: string): Promise<FetchedPage | null> {
  try {
    const html = await readFile(cachePath(key), "utf8");
    let fetchedAt = "unknown";
    try {
      const meta = JSON.parse(await readFile(metaPath(key), "utf8")) as {
        fetchedAt?: string;
      };
      fetchedAt = meta.fetchedAt ?? fetchedAt;
    } catch {
      // ignore
    }
    const seeded = html.match(
      /<pre id="source-text">([\s\S]*?)<\/pre>/i,
    )?.[1];
    const text = decodeBasicEntities(
      (seeded ??
        html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, "\n"))
        .replace(/\n{2,}/g, "\n")
        .trim(),
    );
    if (text.length < 400) return null;
    return { url, html, text, fromCache: true, fetchedAt };
  } catch {
    return null;
  }
}

/**
 * Fetch a page with Playwright. On Cloudflare challenge, fall back to the
 * last good local cache under data/source-cache/.
 */
export async function fetchPageWithBrowser(opts: {
  url: string;
  cacheKey: string;
  waitMs?: number;
}): Promise<FetchedPage> {
  const { url, cacheKey, waitMs = 2500 } = opts;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        locale: "en-GB",
        viewport: { width: 1280, height: 900 },
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(waitMs);
      const title = await page.title();
      const html = await page.content();
      const text = await page.evaluate(() => document.body.innerText || "");
      if (!isChallengePage(title, html, text) && text.length > 400) {
        // Prefer a richer last-good cache over a thin SPA / soft-block page.
        const cached = await loadCache(cacheKey, url);
        if (cached && cached.text.length > text.length * 1.5) {
          return cached;
        }
        await saveCache(cacheKey, url, html);
        return {
          url,
          html,
          text,
          fromCache: false,
          fetchedAt: new Date().toISOString(),
        };
      }
    } finally {
      await browser.close();
    }
  } catch {
    // Fall through to cache
  }

  const cached = await loadCache(cacheKey, url);
  if (cached) return cached;
  throw new Error(
    `Could not fetch ${url} (blocked) and no local source cache at data/source-cache/${cacheKey}.html`,
  );
}

/** Save markdown/text snapshot into the HTML cache wrapper for parsers. */
function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export async function seedTextCache(
  cacheKey: string,
  url: string,
  text: string,
): Promise<void> {
  const html = `<!doctype html><html><head><title>${cacheKey}</title></head><body><pre id="source-text">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre></body></html>`;
  await saveCache(cacheKey, url, html);
}
