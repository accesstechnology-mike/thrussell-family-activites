import type { Activity, ActivitySource, ActivityStore, TerrainLevel } from "./types";

export type ActivitySort = "drive" | "title" | "distance" | "recent";
export type ActivityView = "card" | "full";
/** `all` = every listed feature required (API default). `any` = match at least one. */
export type FeatureMatch = "all" | "any";

export type ActivityQuery = {
  q?: string | null;
  feature?: string | null;
  features?: string[];
  featureMatch?: FeatureMatch;
  source?: ActivitySource | null;
  sources?: ActivitySource[];
  terrain?: TerrainLevel | null;
  terrains?: TerrainLevel[];
  maxDrive?: number | null;
  minDrive?: number | null;
  maxDistanceMiles?: number | null;
  freeOnly?: boolean;
  ids?: string[];
  sort?: ActivitySort;
  limit?: number | null;
  offset?: number | null;
};

export type CardActivity = {
  id: string;
  source: ActivitySource;
  sourceUrl: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string | null;
  locationLabel: string | null;
  postcode: string | null;
  what3words: string | null;
  coordinates: Activity["coordinates"];
  parking: string | null;
  cost: string | null;
  distanceMiles: number | null;
  terrain: TerrainLevel;
  terrainNotes: string | null;
  features: string[];
  categories: string[];
  driveMinutes: number | null;
};

const TERRAINS = new Set<TerrainLevel>([
  "flat",
  "gentle",
  "hilly",
  "steep",
  "unknown",
]);

const SOURCES = new Set<ActivitySource>([
  "reluctant-explorers",
  "national-trust",
  "english-heritage",
  "yorkshire-tots",
  "teesside-family-life",
  "muddy-boots-mummy",
  "little-vikings",
  "alltrails",
]);

export function isTerrain(value: string): value is TerrainLevel {
  return TERRAINS.has(value as TerrainLevel);
}

export function isSource(value: string): value is ActivitySource {
  return SOURCES.has(value as ActivitySource);
}

export function parseCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parsePositiveInt(
  value: string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function parseBooleanFlag(
  value: string | null | undefined,
): boolean {
  if (value == null) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** Looks free / no admission — parking fees alone still count as free entry. */
export function looksFree(cost: string | null | undefined): boolean {
  if (!cost) return false;
  const c = cost.toLowerCase();
  if (/\b(free|no charge|no admission|donation)\b/.test(c)) return true;
  if (/\bpay to park\b/.test(c) && !/\b£\d|\badmission\b|\bticket\b/.test(c)) {
    return true;
  }
  return false;
}

export function toCardActivity(a: Activity): CardActivity {
  return {
    id: a.id,
    source: a.source,
    sourceUrl: a.sourceUrl,
    title: a.title,
    summary: a.summary,
    imageUrl: a.imageUrl,
    imageAlt: a.imageAlt,
    locationLabel: a.locationLabel,
    postcode: a.postcode,
    what3words: a.what3words,
    coordinates: a.coordinates,
    parking: a.parking,
    cost: a.cost,
    distanceMiles: a.distanceMiles,
    terrain: a.terrain,
    terrainNotes: a.terrainNotes,
    features: a.features,
    categories: a.categories,
    driveMinutes: a.driveMinutes,
  };
}

function matchesText(a: Activity, q: string): boolean {
  const blob = [
    a.title,
    a.summary,
    a.locationLabel,
    a.parking,
    a.cost,
    a.postcode,
    a.terrainNotes,
    ...a.features,
    ...a.categories,
    ...Object.values(a.rawFacts),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function sortActivities(activities: Activity[], sort: ActivitySort): void {
  activities.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "distance") {
      const da = a.distanceMiles ?? 9999;
      const db = b.distanceMiles ?? 9999;
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title);
    }
    if (sort === "recent") {
      return b.lastSyncedAt.localeCompare(a.lastSyncedAt);
    }
    const da = a.driveMinutes ?? 9999;
    const db = b.driveMinutes ?? 9999;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });
}

export function queryActivities(
  store: ActivityStore,
  opts: ActivityQuery = {},
): { activities: Activity[]; total: number; applied: ActivityQuery } {
  let activities = [...store.activities];

  const maxDrive = opts.maxDrive ?? store.maxDriveMinutes;
  activities = activities.filter(
    (a) => a.driveMinutes != null && a.driveMinutes <= maxDrive,
  );

  if (opts.minDrive != null) {
    activities = activities.filter(
      (a) => a.driveMinutes != null && a.driveMinutes >= opts.minDrive!,
    );
  }

  if (opts.maxDistanceMiles != null) {
    activities = activities.filter(
      (a) =>
        a.distanceMiles != null && a.distanceMiles <= opts.maxDistanceMiles!,
    );
  }

  const featureNeedles = [
    ...(opts.feature ? [opts.feature] : []),
    ...(opts.features ?? []),
  ].map((f) => f.toLowerCase());

  if (featureNeedles.length) {
    const mode = opts.featureMatch ?? "all";
    activities = activities.filter((a) => {
      const has = (needle: string) =>
        a.features.some((f) => f.toLowerCase() === needle);
      return mode === "any"
        ? featureNeedles.some(has)
        : featureNeedles.every(has);
    });
  }

  const sourceNeedles = [
    ...(opts.source ? [opts.source] : []),
    ...(opts.sources ?? []),
  ];
  if (sourceNeedles.length) {
    const set = new Set(sourceNeedles);
    activities = activities.filter((a) => set.has(a.source));
  }

  const terrainNeedles = [
    ...(opts.terrain ? [opts.terrain] : []),
    ...(opts.terrains ?? []),
  ];
  if (terrainNeedles.length) {
    const set = new Set(terrainNeedles);
    activities = activities.filter((a) => set.has(a.terrain));
  }

  if (opts.freeOnly) {
    activities = activities.filter((a) => looksFree(a.cost));
  }

  if (opts.ids?.length) {
    const set = new Set(opts.ids);
    activities = activities.filter((a) => set.has(a.id));
  }

  if (opts.q) {
    const q = opts.q.toLowerCase().trim();
    if (q) activities = activities.filter((a) => matchesText(a, q));
  }

  const sort = opts.sort ?? "drive";
  sortActivities(activities, sort);

  const total = activities.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? null;
  if (offset > 0) activities = activities.slice(offset);
  if (limit != null) activities = activities.slice(0, limit);

  return {
    activities,
    total,
    applied: {
      ...opts,
      maxDrive,
      sort,
      offset,
      limit,
    },
  };
}

export function catalogueFromStore(store: ActivityStore) {
  const features = [
    ...new Set(store.activities.flatMap((a) => a.features)),
  ].sort((a, b) => a.localeCompare(b));
  const sources = [
    ...new Set(store.activities.map((a) => a.source)),
  ].sort((a, b) => a.localeCompare(b));
  const terrains = [
    ...new Set(store.activities.map((a) => a.terrain)),
  ].sort((a, b) => a.localeCompare(b));
  const categories = [
    ...new Set(store.activities.flatMap((a) => a.categories)),
  ].sort((a, b) => a.localeCompare(b));

  return { features, sources, terrains, categories };
}
