import { decodeEntities } from "./html";
import { haversineKm } from "./sources/listicle";
import type { Activity, ActivitySource, ActivitySourceRef } from "./types";

/** Cluster start pins within ~450m (middle of the 250–500m brief). */
export const CLUSTER_RADIUS_KM = 0.45;
/** Same normalised token set may share a slightly drifted pin. */
export const SAME_KEY_RADIUS_KM = 1.25;
export const CONTAINMENT_RADIUS_KM = 1.0;

const STOP = new Set([
  "the",
  "a",
  "an",
  "walk",
  "walks",
  "walking",
  "circular",
  "trail",
  "trails",
  "family",
  "friendly",
  "kids",
  "children",
  "route",
  "guide",
  "short",
  "easy",
  "best",
  "near",
  "yorkshire",
  "dales",
  "moors",
  "national",
  "trust",
  "visitor",
  "centre",
  "center",
  "sssi",
  "lnr",
  "accessible",
  "dog",
  "dogs",
  "from",
  "via",
  "among",
  "around",
  "with",
  "gallery",
  "garden",
  "gardens",
  "woodland",
  "parkland",
  "wood",
  "woods",
  "forest",
  "nature",
  "reserve",
  "park",
  "parks",
  "and",
  "to",
  "at",
  "on",
  "for",
  "stunning",
  "view",
  "views",
  "fantastic",
  "inspirational",
  "flat",
  "paddling",
  "paddle",
  "spot",
  "some",
  "birds",
  "north",
  "south",
  "east",
  "west",
  "country",
  "estate",
  "water",
  "of",
  "in",
  "by",
  "nt",
  "grounds",
  "cafe",
  "tea",
  "room",
  "shop",
  "mill",
  "force",
  "foss",
  "beck",
  "bank",
  "moor",
  "loop",
  "linear",
  "outing",
  "day",
  "out",
  "days",
  "adventure",
  "explorer",
  "exploring",
  "your",
  "plan",
  "semi",
]);

const DESCRIPTOR = new Set([
  "viaduct",
  "hall",
  "house",
  "garden",
  "ruin",
  "ruins",
  "park",
  "deer",
  "sculpture",
  "wood",
  "common",
  "bay",
  "cliff",
  "reservoir",
  "tarn",
  "gorge",
  "castle",
  "abbey",
  "priory",
  "rock",
  "fall",
  "crag",
  "mill",
  "wetland",
  "fen",
  "field",
  "sssi",
  "garden",
]);

const PLACE_IDENTITY_SOURCES = new Set<ActivitySource>([
  "national-trust",
  "openstreetmap",
  "english-heritage",
]);

const WALK_WRITEUP_SOURCES = new Set<ActivitySource>([
  "reluctant-explorers",
  "where2walk",
  "walkiees",
  "outdoor-guide",
  "yorkshire-tots",
  "teesside-family-life",
  "little-vikings",
  "alltrails",
  "muddy-boots-mummy",
]);

export function stemPlaceToken(tok: string): string {
  if (tok === "falls" || tok === "waterfall" || tok === "waterfalls") {
    return "fall";
  }
  if (tok.endsWith("s") && tok.length > 4) return tok.slice(0, -1);
  return tok;
}

function cleanTitle(title: string): string {
  let t = decodeEntities(title).toLowerCase().replace(/&/g, " and ");
  if (t.includes(":")) {
    const after = t.split(":").slice(1).join(" ").trim();
    if (after.length >= 4) t = after;
  }
  t = t.replace(/\b(near|from|in)\s+[a-z][a-z'’\-]{2,}(?:\s+[a-z][a-z'’\-]+)?/g, " ");
  return t;
}

export function placeTokens(title: string): Set<string> {
  return new Set(
    cleanTitle(title)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length > 2 && !STOP.has(x))
      .map(stemPlaceToken),
  );
}

export function titleHead(title: string): string | null {
  const tokens = [...placeTokens(title)];
  return tokens[0] ?? null;
}

export function routeDestinations(title: string): Set<string> {
  const t = decodeEntities(title).toLowerCase();
  const dests = new Set<string>();
  const re =
    /\b(?:to|via)\s+([^,.;]+?)(?=\s+(?:walk|circular|trail|from|near)|$)/g;
  for (const m of t.matchAll(re)) {
    for (const tok of placeTokens(m[1] ?? "")) dests.add(tok);
  }
  return dests;
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  return isSubset(a, b);
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((t) => b.has(t));
}

function routeConflict(
  destA: Set<string>,
  destB: Set<string>,
  tokensA: Set<string>,
  tokensB: Set<string>,
): boolean {
  if (destA.size && destB.size && intersect(destA, destB).length === 0) {
    return true;
  }
  if (destA.size && !destB.size && ![...destA].every((t) => tokensB.has(t))) {
    return true;
  }
  if (destB.size && !destA.size && ![...destB].every((t) => tokensA.has(t))) {
    return true;
  }
  return false;
}

function meaningfulExtras(tokens: string[]): string[] {
  return tokens.filter((t) => t.length >= 3);
}

function isDescriptorToken(tok: string): boolean {
  return DESCRIPTOR.has(tok);
}

export function areSamePlace(a: Activity, b: Activity): boolean {
  const dist = haversineKm(a.coordinates, b.coordinates);
  if (dist > SAME_KEY_RADIUS_KM) return false;

  const ta = placeTokens(a.title);
  const tb = placeTokens(b.title);
  if (!ta.size || !tb.size) return false;

  const overlap = intersect(ta, tb);
  const extraA = [...ta].filter((t) => !tb.has(t));
  const extraB = [...tb].filter((t) => !ta.has(t));
  const destA = routeDestinations(a.title);
  const destB = routeDestinations(b.title);

  // Same token set (including A→B / B→A walks) is the same place.
  if (setsEqual(ta, tb)) return true;

  // A point-to-point route is not the village / place card it starts or ends at.
  if ((destA.size > 0) !== (destB.size > 0)) return false;

  const shorter = ta.size <= tb.size ? ta : tb;
  const longer = ta.size <= tb.size ? tb : ta;
  if (
    shorter.size >= 2 &&
    isSubset(shorter, longer) &&
    dist <= CONTAINMENT_RADIUS_KM &&
    !routeConflict(destA, destB, ta, tb)
  ) {
    return true;
  }

  if (dist > CLUSTER_RADIUS_KM) return false;
  if (!overlap.length) return false;
  if (routeConflict(destA, destB, ta, tb)) return false;

  const exA = meaningfulExtras(extraA);
  const exB = meaningfulExtras(extraB);
  if (exA.length && exB.length) return false;

  if (overlap.length >= 2) return true;

  const headA = titleHead(a.title);
  const headB = titleHead(b.title);
  if (!headA || headA !== headB || !overlap.includes(headA)) return false;

  const extras = ta.size < tb.size ? extraB : extraA;
  const longerActivity = ta.size < tb.size ? b : a;
  if (!extras.length) return true;
  if (extras.every(isDescriptorToken)) return true;
  if (
    PLACE_IDENTITY_SOURCES.has(longerActivity.source) &&
    isSubset(shorter, longer)
  ) {
    return true;
  }
  return false;
}

export function clusterActivities(activities: Activity[]): Activity[][] {
  const n = activities.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]!));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areSamePlace(activities[i]!, activities[j]!)) union(i, j);
    }
  }

  const groups = new Map<number, Activity[]>();
  for (let i = 0; i < n; i++) {
    const p = find(i);
    const list = groups.get(p);
    if (list) list.push(activities[i]!);
    else groups.set(p, [activities[i]!]);
  }
  return [...groups.values()];
}

function identityRank(source: ActivitySource): number {
  if (source === "national-trust") return 0;
  if (source === "openstreetmap") return 1;
  if (source === "english-heritage") return 2;
  return 3;
}

function looksLikeVisitorCentre(title: string): boolean {
  return /\bvisitor\s+cent(?:re|er)\b|\bsssi\b/i.test(title);
}

function pickIdentity(cluster: Activity[]): Activity {
  return [...cluster].sort((a, b) => {
    const ra = identityRank(a.source);
    const rb = identityRank(b.source);
    if (ra !== rb) return ra - rb;
    const va = looksLikeVisitorCentre(a.title) ? 1 : 0;
    const vb = looksLikeVisitorCentre(b.title) ? 1 : 0;
    if (va !== vb) return va - vb;
    return a.title.length - b.title.length;
  })[0]!;
}

function writeupScore(a: Activity): number {
  return (
    (WALK_WRITEUP_SOURCES.has(a.source) ? 1000 : 0) +
    a.summary.length +
    (a.parking ? 200 : 0) +
    (a.what3words ? 80 : 0) +
    (a.distanceMiles != null ? 120 : 0) +
    (a.terrainNotes ? 60 : 0) +
    (a.terrain !== "unknown" ? 40 : 0)
  );
}

function pickWriteup(cluster: Activity[]): Activity {
  return [...cluster].sort((a, b) => writeupScore(b) - writeupScore(a))[0]!;
}

function pickTitle(identity: Activity, cluster: Activity[]): string {
  if (
    identity.source === "national-trust" ||
    identity.source === "english-heritage"
  ) {
    return decodeEntities(identity.title);
  }
  const scored = cluster.map((a) => {
    const tokens = placeTokens(a.title);
    let score = 0;
    if (a.source === "national-trust") score += 50;
    if (a.source === "english-heritage") score += 40;
    if (a.source === "openstreetmap" && !looksLikeVisitorCentre(a.title)) {
      score += 20;
    }
    if (looksLikeVisitorCentre(a.title)) score -= 40;
    score -= Math.min(a.title.length, 80) / 8;
    score += Math.min(tokens.size, 4);
    return { a, score };
  });
  scored.sort((x, y) => y.score - x.score);
  return decodeEntities(scored[0]!.a.title);
}

function pickImageDonor(cluster: Activity[]): Activity | null {
  const local = cluster.find((a) => a.imageUrl?.startsWith("/media/"));
  if (local) return local;
  return cluster.find((a) => Boolean(a.imageUrl)) ?? null;
}

function firstNonNull<T>(
  items: Activity[],
  read: (a: Activity) => T | null | undefined,
): T | null {
  for (const item of items) {
    const value = read(item);
    if (value != null && value !== "") return value;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function sourceRef(activity: Activity): ActivitySourceRef {
  return {
    source: activity.source,
    sourceUrl: activity.sourceUrl,
    title: decodeEntities(activity.title),
    id: activity.id,
  };
}

export function activitySourceList(activity: Activity): ActivitySourceRef[] {
  if (activity.sources?.length) return activity.sources;
  return [sourceRef(activity)];
}

export function activityHasSource(
  activity: Activity,
  source: ActivitySource,
): boolean {
  if (activity.source === source) return true;
  return activitySourceList(activity).some((s) => s.source === source);
}

export function mergeCluster(cluster: Activity[]): Activity {
  if (cluster.length === 1) {
    const only = cluster[0]!;
    return {
      ...only,
      title: decodeEntities(only.title),
      sources: activitySourceList(only),
    };
  }

  const identity = pickIdentity(cluster);
  const writeup = pickWriteup(cluster);
  const imageDonor = pickImageDonor(cluster);
  const preferForFacts = [identity, writeup, ...cluster];

  const refs: ActivitySourceRef[] = [];
  const seenUrl = new Set<string>();
  for (const item of [identity, ...cluster]) {
    for (const ref of activitySourceList(item)) {
      if (seenUrl.has(ref.sourceUrl)) continue;
      seenUrl.add(ref.sourceUrl);
      refs.push({ ...ref, title: decodeEntities(ref.title) });
    }
  }

  const imageFacts = imageDonor
    ? {
        ...(typeof imageDonor.rawFacts.imageRemote === "string"
          ? { imageRemote: imageDonor.rawFacts.imageRemote }
          : {}),
        ...(typeof imageDonor.rawFacts.imageDetail === "string"
          ? { imageDetail: imageDonor.rawFacts.imageDetail }
          : {}),
      }
    : {};

  return {
    ...identity,
    title: pickTitle(identity, cluster),
    summary: writeup.summary,
    source: identity.source,
    sourceUrl: identity.sourceUrl,
    sources: refs,
    imageUrl: imageDonor?.imageUrl ?? identity.imageUrl,
    imageAlt:
      imageDonor?.imageAlt ||
      identity.imageAlt ||
      pickTitle(identity, cluster),
    locationLabel:
      identity.locationLabel ?? writeup.locationLabel ?? firstNonNull(cluster, (a) => a.locationLabel),
    postcode:
      identity.postcode ?? writeup.postcode ?? firstNonNull(cluster, (a) => a.postcode),
    what3words: firstNonNull(
      [writeup, identity, ...cluster],
      (a) => a.what3words,
    ),
    coordinates: identity.coordinates,
    driveMinutes: identity.driveMinutes,
    parking: firstNonNull([writeup, identity, ...cluster], (a) => a.parking),
    cost: firstNonNull([identity, writeup, ...cluster], (a) => a.cost),
    isFree: firstNonNull([identity, writeup, ...cluster], (a) => a.isFree),
    distanceMiles: firstNonNull(
      [writeup, ...cluster],
      (a) => a.distanceMiles,
    ),
    terrain:
      writeup.terrain !== "unknown" ? writeup.terrain : identity.terrain,
    terrainNotes: firstNonNull(
      [writeup, ...cluster],
      (a) => a.terrainNotes,
    ),
    features: uniqueStrings(cluster.flatMap((a) => a.features)),
    categories: uniqueStrings(cluster.flatMap((a) => a.categories)),
    lastSyncedAt: cluster
      .map((a) => a.lastSyncedAt)
      .sort()
      .at(-1)!,
    rawFacts: {
      ...writeup.rawFacts,
      ...identity.rawFacts,
      ...imageFacts,
      openingHours:
        firstNonNull(preferForFacts, (a) => a.rawFacts.openingHours) ??
        identity.rawFacts.openingHours,
      phone:
        firstNonNull(preferForFacts, (a) => a.rawFacts.phone) ??
        identity.rawFacts.phone,
    },
  };
}

export type DedupeStats = {
  before: number;
  after: number;
  clusters: number;
  listingsMerged: number;
};

export function mergeDuplicateActivities(activities: Activity[]): {
  activities: Activity[];
  stats: DedupeStats;
} {
  const clusters = clusterActivities(activities);
  const merged = clusters
    .map(mergeCluster)
    .sort((a, b) => (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0));
  const multi = clusters.filter((c) => c.length > 1);
  return {
    activities: merged,
    stats: {
      before: activities.length,
      after: merged.length,
      clusters: multi.length,
      listingsMerged: multi.reduce((sum, c) => sum + c.length, 0),
    },
  };
}
