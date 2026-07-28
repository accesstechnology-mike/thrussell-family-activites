import { FEATURE_LABELS } from "./features";
import {
  isSource,
  isTerrain,
  looksFree,
  queryActivities,
  type ActivityQuery,
} from "./query";
import type {
  Activity,
  ActivitySource,
  ActivityStore,
  TerrainLevel,
} from "./types";

export type InterpretedQuery = ActivityQuery & {
  raw: string;
  residualQ: string | null;
  notes: string[];
};

export type Suggestion = {
  score: number;
  why: string[];
  activity: Activity;
};

const FEATURE_ALIASES: Array<{ label: string; pattern: RegExp }> = [
  { label: "stepping stones", pattern: /\bstepping\s+stones?\b/i },
  { label: "cave", pattern: /\bcaves?\b/i },
  { label: "waterfall", pattern: /\bwaterfalls?\b|\bforce\b|\bfoss\b/i },
  { label: "rope swing", pattern: /\brope\s+swings?\b/i },
  { label: "ice cream", pattern: /\bice\s*creams?\b/i },
  { label: "play park", pattern: /\bplay\s*parks?\b|\bplaygrounds?\b/i },
  { label: "paddle", pattern: /\bpaddl(?:e|ing)\b|\bwild\s+swim|\bsplash(?:ing)?\b/i },
  { label: "ruins", pattern: /\bruins?\b|\babbey\b|\bcastles?\b/i },
  { label: "woodland", pattern: /\bwoodlands?\b|\bwoods?\b|\bforest\b/i },
  { label: "stream / river", pattern: /\brivers?\b|\bstreams?\b|\bbecks?\b/i },
  { label: "trig point", pattern: /\btrig(?:\s+point)?\b|\bpeak\s+to\s+bag\b|\bsummit\b/i },
  { label: "cafe / pub", pattern: /\bcafe\b|\bcafé\b|\bpubs?\b|\btea\s*room|\blunch\b|\bcoffee\b/i },
  { label: "pushchair friendly", pattern: /\bpushchair\b|\bpram\b|\bbuggy\b|\bwheelchair\b|\bstroller\b/i },
  { label: "beach", pattern: /\bbeach(?:es)?\b|\bcoast(?:al)?\b|\bseaside\b/i },
  { label: "animals", pattern: /\bdeer\b|\bfell\s+ponies?\b|\bfarm\s+animals?\b|\banimals?\b/i },
  { label: "rocks to scramble", pattern: /\bscrambl|\bboulders?\b/i },
];

const SOURCE_ALIASES: Array<{ source: ActivitySource; pattern: RegExp }> = [
  { source: "reluctant-explorers", pattern: /\breluctant\s+explorers?\b|\btre\b/i },
  { source: "national-trust", pattern: /\bnational\s+trust\b|\bnt\b/i },
  { source: "english-heritage", pattern: /\benglish\s+heritage\b/i },
  { source: "yorkshire-tots", pattern: /\byorkshire\s+tots\b/i },
  { source: "teesside-family-life", pattern: /\bteesside\s+family\b/i },
  { source: "muddy-boots-mummy", pattern: /\bmuddy\s+boots\b/i },
  { source: "little-vikings", pattern: /\blittle\s+vikings?\b/i },
  { source: "alltrails", pattern: /\ball\s*trails?\b/i },
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "near",
  "around",
  "within",
  "under",
  "less",
  "than",
  "about",
  "some",
  "any",
  "good",
  "nice",
  "best",
  "fun",
  "family",
  "kids",
  "kid",
  "children",
  "child",
  "outing",
  "outings",
  "walk",
  "walks",
  "walking",
  "place",
  "places",
  "spot",
  "spots",
  "suggestion",
  "suggestions",
  "suggest",
  "recommend",
  "recommendation",
  "recommendations",
  "please",
  "find",
  "show",
  "me",
  "us",
  "something",
  "somewhere",
  "today",
  "this",
  "weekend",
  "drive",
  "minute",
  "minutes",
  "min",
  "mins",
  "hour",
  "hours",
  "away",
  "from",
  "home",
  "that",
  "is",
  "are",
  "be",
  "can",
  "we",
  "i",
  "our",
  "my",
]);

function extractDriveCap(text: string): { maxDrive: number | null; matched: string | null } {
  const under = text.match(
    /\b(?:under|within|less than|no more than|max(?:imum)?)\s+(\d+)\s*(?:minutes?|mins?|min)\b/i,
  );
  if (under) {
    return { maxDrive: Number(under[1]), matched: under[0] };
  }

  const hourish = text.match(
    /\b(?:under|within|less than|no more than)\s+(?:an?\s+)?(\d+(?:\.\d+)?)\s*hours?\b/i,
  );
  if (hourish) {
    return {
      maxDrive: Math.round(Number(hourish[1]) * 60),
      matched: hourish[0],
    };
  }

  if (/\bwithin an hour\b|\bunder an hour\b|\bless than an hour\b/i.test(text)) {
    return { maxDrive: 60, matched: "within an hour" };
  }

  if (/\bhalf an hour\b|\b30\s*mins?\b/i.test(text)) {
    return { maxDrive: 30, matched: "half an hour" };
  }

  const bareMins = text.match(/\b(\d+)\s*(?:minutes?|mins?)\b/i);
  if (bareMins && Number(bareMins[1]) <= 120) {
    return { maxDrive: Number(bareMins[1]), matched: bareMins[0] };
  }

  return { maxDrive: null, matched: null };
}

function extractDistanceCap(
  text: string,
): { maxDistanceMiles: number | null; matched: string | null } {
  const m = text.match(
    /\b(?:under|within|less than|no more than|short(?:er)?)\s+(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i,
  );
  if (m) {
    return { maxDistanceMiles: Number(m[1]), matched: m[0] };
  }
  const short = text.match(/\bshort\s+walk\b/i);
  if (short) {
    return { maxDistanceMiles: 3, matched: short[0] };
  }
  return { maxDistanceMiles: null, matched: null };
}

function stripMatched(text: string, matched: Array<string | null | undefined>): string {
  let out = text;
  for (const m of matched) {
    if (!m) continue;
    out = out.replace(new RegExp(escapeRegExp(m), "ig"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function residualSearchTerms(
  text: string,
  featureLabels: string[] = [],
): string | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const featureWords = new Set(
    featureLabels.flatMap((label) =>
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  );

  const kept = cleaned
    .split(" ")
    .filter(
      (w) => w.length > 2 && !STOPWORDS.has(w) && !featureWords.has(w),
    );
  if (!kept.length) return null;
  return kept.join(" ");
}

/**
 * Turn a natural-language outing request into structured filters.
 * Deterministic (no LLM) so Hermes can pass user text straight through.
 */
export function interpretOutingRequest(raw: string): InterpretedQuery {
  const notes: string[] = [];
  const text = raw.trim();
  const matched: string[] = [];

  const features: string[] = [];
  for (const { label, pattern } of FEATURE_ALIASES) {
    const m = text.match(pattern);
    if (m) {
      features.push(label);
      matched.push(m[0]);
    }
  }
  for (const label of FEATURE_LABELS) {
    if (features.includes(label)) continue;
    if (text.toLowerCase().includes(label.toLowerCase())) {
      features.push(label);
      matched.push(label);
    }
  }

  const terrains: TerrainLevel[] = [];
  for (const t of ["flat", "gentle", "hilly", "steep"] as TerrainLevel[]) {
    const re = new RegExp(`\\b${t}\\b`, "i");
    const m = text.match(re);
    if (m) {
      terrains.push(t);
      matched.push(m[0]);
    }
  }
  // "easy" implies terrain; pushchair is already a feature tag — don't double-filter.
  if (/\beasy\b/i.test(text) && !terrains.length) {
    terrains.push("flat", "gentle");
    notes.push("Interpreted easy as flat or gentle terrain");
  }

  const sources: ActivitySource[] = [];
  for (const { source, pattern } of SOURCE_ALIASES) {
    const m = text.match(pattern);
    if (m) {
      sources.push(source);
      matched.push(m[0]);
    }
  }

  const drive = extractDriveCap(text);
  if (drive.matched) matched.push(drive.matched);

  const distance = extractDistanceCap(text);
  if (distance.matched) matched.push(distance.matched);

  let freeOnly = false;
  if (/\bfree\b|\bno\s+cost\b|\bno\s+admission\b/i.test(text)) {
    freeOnly = true;
    matched.push("free");
  }

  const residual = stripMatched(text, [...matched, ...features]);
  const residualQ = residualSearchTerms(residual, features);

  if (features.length) notes.push(`Features: ${features.join(", ")}`);
  if (drive.maxDrive != null) notes.push(`Max drive: ${drive.maxDrive} min`);
  if (distance.maxDistanceMiles != null) {
    notes.push(`Max walk distance: ${distance.maxDistanceMiles} miles`);
  }
  if (freeOnly) notes.push("Free / no admission preferred");
  if (residualQ) notes.push(`Text match: ${residualQ}`);

  return {
    raw,
    residualQ,
    notes,
    q: residualQ,
    features,
    terrains: terrains.length ? terrains : undefined,
    terrain: terrains.length === 1 ? terrains[0]! : null,
    sources: sources.length ? sources : undefined,
    source: sources.length === 1 ? sources[0]! : null,
    maxDrive: drive.maxDrive,
    maxDistanceMiles: distance.maxDistanceMiles,
    freeOnly,
    sort: "drive",
  };
}

export function scoreSuggestion(
  activity: Activity,
  interpreted: InterpretedQuery,
): Suggestion {
  const why: string[] = [];
  let score = 0;

  const wantedFeatures = interpreted.features ?? [];
  for (const f of wantedFeatures) {
    if (activity.features.some((af) => af.toLowerCase() === f.toLowerCase())) {
      score += 25;
      why.push(`Has ${f}`);
    }
  }

  if (
    interpreted.maxDrive != null &&
    activity.driveMinutes != null &&
    activity.driveMinutes <= interpreted.maxDrive
  ) {
    score += 15;
    why.push(`${activity.driveMinutes} min drive (≤ ${interpreted.maxDrive})`);
  } else if (activity.driveMinutes != null) {
    score += Math.max(0, 12 - Math.floor(activity.driveMinutes / 15));
    why.push(`${activity.driveMinutes} min drive`);
  }

  if (
    interpreted.maxDistanceMiles != null &&
    activity.distanceMiles != null &&
    activity.distanceMiles <= interpreted.maxDistanceMiles
  ) {
    score += 10;
    why.push(`${activity.distanceMiles} mile walk`);
  }

  if (interpreted.terrains?.includes(activity.terrain)) {
    score += 8;
    why.push(`${activity.terrain} terrain`);
  }

  if (interpreted.freeOnly && looksFree(activity.cost)) {
    score += 8;
    why.push(activity.cost ? `Cost: ${activity.cost}` : "Looks free");
  }

  if (interpreted.residualQ) {
    const q = interpreted.residualQ.toLowerCase();
    const titleHit = activity.title.toLowerCase().includes(q);
    const summaryHit = activity.summary.toLowerCase().includes(q);
    const locationHit = (activity.locationLabel || "").toLowerCase().includes(q);
    if (titleHit) {
      score += 20;
      why.push("Title matches request");
    } else if (locationHit) {
      score += 12;
      why.push(`Near ${activity.locationLabel}`);
    } else if (summaryHit) {
      score += 8;
      why.push("Summary matches request");
    } else {
      for (const term of q.split(" ")) {
        if (term.length < 3) continue;
        if (activity.title.toLowerCase().includes(term)) {
          score += 6;
          why.push(`Mentions “${term}”`);
          break;
        }
      }
    }
  }

  if (activity.source === "reluctant-explorers") {
    score += 2;
  }

  if (!why.length) {
    why.push("Within your usual drive range from home");
  }

  return { score, why, activity };
}

export function rankSuggestions(
  activities: Activity[],
  interpreted: InterpretedQuery,
  limit = 5,
): Suggestion[] {
  return activities
    .map((a) => scoreSuggestion(a, interpreted))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = a.activity.driveMinutes ?? 9999;
      const db = b.activity.driveMinutes ?? 9999;
      if (da !== db) return da - db;
      return a.activity.title.localeCompare(b.activity.title);
    })
    .slice(0, limit);
}

function hasAnyFeature(activity: Activity, features: string[]): boolean {
  const wanted = new Set(features.map((f) => f.toLowerCase()));
  return activity.features.some((f) => wanted.has(f.toLowerCase()));
}

function featureCoverage(activities: Activity[], features: string[]): string[] {
  return features.filter((f) =>
    activities.some((a) =>
      a.features.some((af) => af.toLowerCase() === f.toLowerCase()),
    ),
  );
}

/**
 * Build a candidate pool for NL suggest.
 * Prefer keeping requested features even if that means relaxing drive time.
 */
export function buildSuggestPool(
  store: ActivityStore,
  interpreted: InterpretedQuery,
): { pool: Activity[]; notes: string[] } {
  const notes: string[] = [];
  const features = interpreted.features ?? [];
  const hardQ =
    features.length ||
    interpreted.terrains?.length ||
    interpreted.freeOnly ||
    interpreted.maxDistanceMiles != null
      ? null
      : interpreted.q;

  const base = {
    features,
    featureMatch: "any" as const,
    sources: interpreted.sources,
    terrains: interpreted.terrains,
    maxDistanceMiles: interpreted.maxDistanceMiles,
    freeOnly: interpreted.freeOnly,
    q: hardQ,
    sort: "drive" as const,
  };

  let pool = queryActivities(store, {
    ...base,
    maxDrive: interpreted.maxDrive,
  }).activities;

  if (!pool.length && hardQ) {
    pool = queryActivities(store, {
      ...base,
      q: null,
      maxDrive: interpreted.maxDrive,
    }).activities;
  }

  // If the user asked for features but the drive cap wiped them out, keep the
  // features and relax drive — that's what humans mean by the ask.
  if (features.length) {
    const covered = featureCoverage(pool, features);
    if (!covered.length || covered.length < features.length) {
      const wider = queryActivities(store, {
        ...base,
        q: null,
        maxDrive: null,
      }).activities;
      if (wider.length) {
        const missing = features.filter((f) => !covered.includes(f));
        if (interpreted.maxDrive != null && missing.length) {
          notes.push(
            `No ${missing.join(" / ")} within ${interpreted.maxDrive} min — showing nearest matches instead`,
          );
        } else if (!covered.length) {
          notes.push("Relaxed filters to keep requested features");
        }
        pool = wider;
      }
    }
  }

  if (!pool.length && interpreted.q) {
    pool = queryActivities(store, {
      q: interpreted.q,
      maxDrive: interpreted.maxDrive,
      sort: "drive",
    }).activities;
    if (pool.length) notes.push("Fell back to text search only");
  }

  if (!pool.length) {
    pool = queryActivities(store, {
      maxDrive: interpreted.maxDrive,
      sort: "drive",
      limit: 40,
    }).activities;
    if (pool.length) {
      notes.push("No close filter match — nearest outings within drive range");
    }
  }

  // Drop distractors that only matched a secondary feature when a primary
  // requested feature exists in the pool (e.g. cafe-only vs stepping stones).
  if (features.length > 1) {
    const primaryHits = pool.filter((a) => hasAnyFeature(a, features));
    const withAll = pool.filter((a) =>
      features.every((f) =>
        a.features.some((af) => af.toLowerCase() === f.toLowerCase()),
      ),
    );
    if (withAll.length) {
      pool = withAll;
    } else if (primaryHits.length) {
      // Prefer activities that match the rarer / first-mentioned feature.
      const primary = features[0]!;
      const primaryOnly = pool.filter((a) =>
        a.features.some((af) => af.toLowerCase() === primary.toLowerCase()),
      );
      if (primaryOnly.length) pool = primaryOnly;
    }
  } else if (features.length === 1) {
    const primaryOnly = pool.filter((a) => hasAnyFeature(a, features));
    if (primaryOnly.length) pool = primaryOnly;
  }

  return { pool, notes };
}

export function validateStructuredFilters(input: {
  feature?: string | null;
  features?: string[];
  source?: string | null;
  sources?: string[];
  terrain?: string | null;
  terrains?: string[];
}): { ok: true } | { ok: false; error: string } {
  for (const s of [
    ...(input.source ? [input.source] : []),
    ...(input.sources ?? []),
  ]) {
    if (!isSource(s)) return { ok: false, error: `Unknown source: ${s}` };
  }
  for (const t of [
    ...(input.terrain ? [input.terrain] : []),
    ...(input.terrains ?? []),
  ]) {
    if (!isTerrain(t)) return { ok: false, error: `Unknown terrain: ${t}` };
  }
  return { ok: true };
}
