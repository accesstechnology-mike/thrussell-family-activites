/** Shared HTML helpers for live source pages. */

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `(?:property|name)="${property}"\\s+content="([^"]+)"`,
    "i",
  );
  const m = html.match(re) ?? html.match(
    new RegExp(`content="([^"]+)"\\s+(?:property|name)="${property}"`, "i"),
  );
  return m?.[1] ? decodeEntities(m[1]).trim() : null;
}

export function parseJsonLd(html: string): unknown[] {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const out: unknown[] = [];
  for (const block of blocks) {
    try {
      out.push(JSON.parse(decodeEntities(block[1] ?? "")));
    } catch {
      // Ignore broken JSON-LD blocks
    }
  }
  return out;
}

export function jsonLdGraph(html: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const block of parseJsonLd(html)) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    const graph = rec["@graph"];
    if (Array.isArray(graph)) {
      for (const node of graph) {
        if (node && typeof node === "object") {
          items.push(node as Record<string, unknown>);
        }
      }
    } else {
      items.push(rec);
    }
  }
  return items;
}

export function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 20000, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${url}`);
  }
  return res.text();
}
