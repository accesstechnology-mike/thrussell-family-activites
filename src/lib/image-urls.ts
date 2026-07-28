import type { Activity } from "./types";

/** Prefer locally cached detail image when present. */
export function detailImageUrl(activity: Activity): string | null {
  if (activity.rawFacts?.imageDetail) return activity.rawFacts.imageDetail;
  if (activity.imageUrl?.includes("-card.webp")) {
    return activity.imageUrl.replace("-card.webp", "-detail.webp");
  }
  return activity.imageUrl;
}
