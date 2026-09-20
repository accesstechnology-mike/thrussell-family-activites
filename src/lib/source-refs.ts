import { decodeEntities } from "./html";
import type { Activity, ActivitySource, ActivitySourceRef } from "./types";

/** Browser-safe helpers — do not import geocode, images, or other node:fs modules. */

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
