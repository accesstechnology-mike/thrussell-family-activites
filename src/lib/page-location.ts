import { USER_AGENT } from "./config";
import { extractPostcode, geocodePlaceName, geocodePostcode } from "./geocode";
import { fetchText, jsonLdGraph, metaContent, stripTags } from "./html";
import { convertWhat3Words } from "./maps";
import { extractOsGridRef, osGridToWgs84 } from "./os-grid";
import type { LatLng } from "./types";

export type CoordSource =
  | "page-latlng"
  | "os-grid"
  | "postcode"
  | "what3words"
  | "title-geocode";

export type ResolvedLocation = LatLng & {
  postcode: string | null;
  what3words: string | null;
  coordSource: CoordSource;
  coordDetail: string | null;
};

const UK_LAT = { min: 49, max: 61 };
const UK_LNG = { min: -9, max: 2.6 };

export function isPlausibleUk(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UK_LAT.min &&
    lat <= UK_LAT.max &&
    lng >= UK_LNG.min &&
    lng <= UK_LNG.max
  );
}

function pair(
  latRaw: unknown,
  lngRaw: unknown,
  detail: string,
): { lat: number; lng: number; detail: string } | null {
  const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);
  if (!isPlausibleUk(lat, lng)) return null;
  return { lat, lng, detail };
}

function walkJson(value: unknown, visit: (rec: Record<string, unknown>) => void) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    visit(rec);
    for (const child of Object.values(rec)) walkJson(child, visit);
  }
}

/** Explicit WGS84 start pin from page HTML (meta, JSON-LD, maps, data attrs). */
export function extractPageLatLng(
  html: string,
): { lat: number; lng: number; detail: string } | null {
  const varPair = html.match(
    /\bvar\s+lat(?:itude)?\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*var\s+l(?:ng|on|ongitude)\s*=\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (varPair) {
    const hit = pair(varPair[1], varPair[2], `var lat=${varPair[1]} lng=${varPair[2]}`);
    if (hit) return hit;
  }

  for (const node of jsonLdGraph(html)) {
    let found: { lat: number; lng: number; detail: string } | null = null;
    walkJson(node, (rec) => {
      if (found) return;
      const geo =
        rec.geo && typeof rec.geo === "object"
          ? (rec.geo as Record<string, unknown>)
          : rec;
      const hit = pair(
        geo.latitude ?? geo.lat,
        geo.longitude ?? geo.lng ?? geo.lon,
        "json-ld",
      );
      if (hit) found = hit;
    });
    if (found) return found;
  }

  const geoPos =
    metaContent(html, "geo.position") ||
    metaContent(html, "ICBM") ||
    metaContent(html, "icbm");
  if (geoPos) {
    const parts = geoPos.split(/[,;\s]+/).filter(Boolean);
    const hit = pair(parts[0], parts[1], `meta:${geoPos}`);
    if (hit) return hit;
  }
  const metaLat =
    metaContent(html, "geo.latitude") ||
    metaContent(html, "og:latitude") ||
    metaContent(html, "place:location:latitude");
  const metaLng =
    metaContent(html, "geo.longitude") ||
    metaContent(html, "og:longitude") ||
    metaContent(html, "place:location:longitude");
  if (metaLat && metaLng) {
    const hit = pair(metaLat, metaLng, `meta lat/lng`);
    if (hit) return hit;
  }

  const dataLat = html.match(
    /data-(?:lat|latitude)=["'](-?\d+(?:\.\d+)?)["']/i,
  );
  const dataLng = html.match(
    /data-(?:lng|lon|longitude)=["'](-?\d+(?:\.\d+)?)["']/i,
  );
  if (dataLat && dataLng) {
    const hit = pair(dataLat[1], dataLng[1], "data-lat/lng");
    if (hit) return hit;
  }

  const mapPatterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /[?&]center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /setView\(\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /L\.marker\(\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /latLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /new\s+google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of mapPatterns) {
    const m = html.match(re);
    if (!m) continue;
    const hit = pair(m[1], m[2], m[0].slice(0, 80));
    if (hit) return hit;
  }

  return null;
}

export function extractWhat3Words(text: string): string | null {
  const labelled = text.match(
    /what\s*3\s*words\s*:?\s*\/{0,3}([a-z]+\.[a-z]+\.[a-z]+)/i,
  );
  if (labelled?.[1]) return labelled[1].toLowerCase();
  const linked = text.match(
    /(?:what3words\.com\/|\/\/\/)([a-z]+\.[a-z]+\.[a-z]+)/i,
  );
  return linked?.[1]?.toLowerCase() ?? null;
}

type ExtractedHints = {
  latlng: { lat: number; lng: number; detail: string } | null;
  gridRef: string | null;
  postcode: string | null;
  what3words: string | null;
};

export function extractLocationHints(html: string): ExtractedHints {
  const stripped = stripTags(html);
  return {
    latlng: extractPageLatLng(html),
    gridRef: extractOsGridRef(html) || extractOsGridRef(stripped),
    postcode: extractPostcode(stripped),
    what3words: extractWhat3Words(html) || extractWhat3Words(stripped),
  };
}

/**
 * Resolve a walk start pin. Title geocode is last resort only.
 * Order: page lat/lng → OS grid → postcode → what3words → cleaned title.
 */
export async function resolvePageLocation(opts: {
  html?: string | null;
  pageUrl?: string | null;
  title?: string | null;
  regionSuffix?: string;
}): Promise<ResolvedLocation | null> {
  let html = opts.html ?? "";
  let hints = extractLocationHints(html);

  if (opts.pageUrl && !hints.latlng) {
    try {
      const page = await fetchText(opts.pageUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        timeoutMs: 15000,
      });
      html = `${html}\n${page}`;
      hints = extractLocationHints(html);
    } catch {
      // Public page unavailable — continue with content HTML / fallbacks.
    }
  }

  const extras = {
    postcode: hints.postcode,
    what3words: hints.what3words,
  };

  if (hints.latlng) {
    return {
      lat: hints.latlng.lat,
      lng: hints.latlng.lng,
      ...extras,
      coordSource: "page-latlng",
      coordDetail: hints.latlng.detail,
    };
  }

  if (hints.gridRef) {
    const converted = osGridToWgs84(hints.gridRef);
    if (converted) {
      return {
        ...converted,
        ...extras,
        coordSource: "os-grid",
        coordDetail: hints.gridRef,
      };
    }
  }

  if (hints.postcode) {
    const pc = await geocodePostcode(hints.postcode);
    if (pc) {
      return {
        lat: pc.lat,
        lng: pc.lng,
        postcode: pc.postcode,
        what3words: extras.what3words,
        coordSource: "postcode",
        coordDetail: pc.postcode,
      };
    }
  }

  if (hints.what3words) {
    try {
      const pin = await convertWhat3Words(hints.what3words);
      return {
        lat: pin.lat,
        lng: pin.lng,
        postcode: extras.postcode,
        what3words: pin.words,
        coordSource: "what3words",
        coordDetail: pin.words,
      };
    } catch {
      // Invalid / unresolvable what3words — try title last.
    }
  }

  const title = opts.title?.trim();
  if (title && title.length >= 3) {
    const region = opts.regionSuffix ?? "Yorkshire";
    const place = await geocodePlaceName(`${title}, ${region}, UK`);
    if (place) {
      return {
        lat: place.lat,
        lng: place.lng,
        postcode: place.postcode ?? extras.postcode,
        what3words: extras.what3words,
        coordSource: "title-geocode",
        coordDetail: title,
      };
    }
  }

  return null;
}

export function locationRawFacts(
  resolved: ResolvedLocation,
): Record<string, string> {
  const facts: Record<string, string> = {
    coordSource: resolved.coordSource,
  };
  if (resolved.coordDetail) facts.coordDetail = resolved.coordDetail;
  return facts;
}
