import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOME_POSTCODE, MAX_DRIVE_MINUTES } from "./config";
import { isFreeActivity } from "./free";
import { queryActivities, type ActivityQuery } from "./query";
import type { Activity, ActivityStore, SourceStatus } from "./types";

function resolveStorePath(): string {
  // Keep path statically scoped under ./data for bundler tracing.
  return path.join(/* turbopackIgnore: true */ process.cwd(), "data", "activities.json");
}

function emptyStore(): ActivityStore {
  return {
    version: 1,
    originPostcode: HOME_POSTCODE,
    origin: { lat: Number.NaN, lng: Number.NaN },
    maxDriveMinutes: MAX_DRIVE_MINUTES,
    syncedAt: null,
    activities: [],
    sourceStatuses: [],
  };
}

export async function readStore(): Promise<ActivityStore> {
  try {
    const raw = await readFile(resolveStorePath(), "utf8");
    const parsed = JSON.parse(raw) as ActivityStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.activities)) {
      return emptyStore();
    }
    parsed.activities = parsed.activities.map((a) => ({
      ...a,
      // Always recompute — stored flags go stale when detection rules change.
      isFree: isFreeActivity({ ...a, isFree: null }),
      rawFacts: a.rawFacts ?? {},
    }));
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStore();
    throw err;
  }
}

export async function writeStore(store: ActivityStore): Promise<void> {
  const full = resolveStorePath();
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, full);
}

export async function listActivities(
  opts?: ActivityQuery,
): Promise<{
  store: ActivityStore;
  activities: Activity[];
  total: number;
  applied: ActivityQuery;
}> {
  const store = await readStore();
  const { activities, total, applied } = queryActivities(store, opts ?? {});
  return { store, activities, total, applied };
}

export async function getActivityById(id: string): Promise<Activity | null> {
  const store = await readStore();
  return store.activities.find((a) => a.id === id) ?? null;
}

export function summariseStatuses(statuses: SourceStatus[]): string {
  return statuses
    .map((s) =>
      s.ok
        ? `${s.source}: ${s.kept}/${s.fetched}`
        : `${s.source}: error (${s.error})`,
    )
    .join("; ");
}
