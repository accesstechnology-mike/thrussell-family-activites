import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOME_POSTCODE, MAX_DRIVE_MINUTES, STORE_PATH } from "./config";
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

export async function listActivities(opts?: {
  feature?: string | null;
  q?: string | null;
  maxDrive?: number | null;
}): Promise<{ store: ActivityStore; activities: Activity[] }> {
  const store = await readStore();
  let activities = [...store.activities];

  const maxDrive = opts?.maxDrive ?? store.maxDriveMinutes;
  activities = activities.filter(
    (a) => a.driveMinutes != null && a.driveMinutes <= maxDrive,
  );

  if (opts?.feature) {
    const needle = opts.feature.toLowerCase();
    activities = activities.filter((a) =>
      a.features.some((f) => f.toLowerCase() === needle),
    );
  }

  if (opts?.q) {
    const q = opts.q.toLowerCase();
    activities = activities.filter((a) => {
      const blob = [
        a.title,
        a.summary,
        a.locationLabel,
        a.parking,
        a.cost,
        ...a.features,
        ...a.categories,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  activities.sort((a, b) => {
    const da = a.driveMinutes ?? 9999;
    const db = b.driveMinutes ?? 9999;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });

  return { store, activities };
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
