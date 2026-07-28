import type { TerrainLevel } from "./types";

/** Notable kid-interest cues extracted from source text (not a fixed activity list). */
const FEATURE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "stepping stones", pattern: /\bstepping\s+stones?\b/i },
  { label: "cave", pattern: /\bcaves?\b/i },
  { label: "waterfall", pattern: /\bwaterfalls?\b|\bforce\b|\bfoss\b/i },
  { label: "rope swing", pattern: /\brope\s+swings?\b/i },
  { label: "ice cream", pattern: /\bice\s*creams?\b/i },
  { label: "play park", pattern: /\bplay\s*parks?\b|\bplaygrounds?\b/i },
  { label: "paddle", pattern: /\bpaddl(?:e|ing)\b|\bwild\s+swim/i },
  { label: "ruins", pattern: /\bruins?\b|\babbey\b|\bcastles?\b/i },
  { label: "woodland", pattern: /\bwoodlands?\b|\bwoods?\b|\bforest\b/i },
  { label: "stream / river", pattern: /\brivers?\b|\bstreams?\b|\bbecks?\b/i },
  { label: "trig point", pattern: /\btrig(?:\s+point)?\b|\bpeak\s+to\s+bag\b|\bsummit\b/i },
  { label: "cafe / pub", pattern: /\bcafe\b|\bcafé\b|\bpubs?\b|\btea\s*room/i },
  { label: "pushchair friendly", pattern: /\bpushchair\b|\bpram\b|\bwheelchair\b/i },
  { label: "beach", pattern: /\bbeach(?:es)?\b|\bcoast(?:al)?\b/i },
  { label: "animals", pattern: /\bdeer\b|\bfell\s+ponies?\b|\bfarm\s+animals?\b/i },
  { label: "rocks to scramble", pattern: /\bscrambl|\bboulders?\b/i },
];

export function extractFeatures(...chunks: Array<string | null | undefined>): string[] {
  const hay = chunks.filter(Boolean).join("\n");
  const found: string[] = [];
  for (const { label, pattern } of FEATURE_PATTERNS) {
    if (pattern.test(hay)) found.push(label);
  }
  return found;
}

export function inferTerrain(
  terrainText: string | null | undefined,
  ...extra: Array<string | null | undefined>
): { terrain: TerrainLevel; notes: string | null } {
  const notes = terrainText?.trim() || null;
  // Prefer the dedicated Terrain fact when present.
  const primary = (terrainText || "").toLowerCase();
  const hay = primary || [terrainText, ...extra].filter(Boolean).join(" ").toLowerCase();

  if (!hay) return { terrain: "unknown", notes };

  if (
    /\b(little to no ascent|no ascent|easy terrain|easy footpaths|mostly flat|flat|level|pushchair|pram)\b/i.test(
      hay,
    )
  ) {
    if (/\b(steep|scrambl|strenuous)\b/i.test(hay) && !/\blittle to no ascent\b/i.test(hay)) {
      return { terrain: "steep", notes };
    }
    if (/\blittle to no ascent|easy terrain|easy footpaths\b/i.test(hay)) {
      return { terrain: "gentle", notes };
    }
    return { terrain: "flat", notes };
  }

  if (/\b(steep|scrambl|strenuous|challenging|mountain)\b/i.test(hay)) {
    return { terrain: "steep", notes };
  }
  if (/\b(hilly|hills?|ascent|climb|undulating|uphill)\b/i.test(hay)) {
    return { terrain: "hilly", notes };
  }
  if (/\b(gentle|mild)\b/i.test(hay)) {
    return { terrain: "gentle", notes };
  }

  return { terrain: "unknown", notes };
}

export function parseDistanceMiles(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function slugId(source: string, title: string, urlOrKey: string): string {
  const base = `${source}-${title}-${urlOrKey}`
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return base || `${source}-activity`;
}
