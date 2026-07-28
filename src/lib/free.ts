import type { Activity } from "./types";

/**
 * Infer whether the outing itself is free (parking charges still OK).
 * Uses source text only — never hardcoded place lists.
 */
export function isFreeActivity(activity: Activity): boolean {
  if (typeof activity.isFree === "boolean") return activity.isFree;

  const cost = (activity.cost || "").toLowerCase();
  const parking = (activity.parking || "").toLowerCase();
  const summary = (activity.summary || "").toLowerCase();
  const tags = activity.features.join(" ").toLowerCase();
  const hay = `${cost}\n${summary}\n${tags}`;

  if (
    /\b(admission|entry fee|ticket|tickets|entrance fee)\b/i.test(hay) &&
    !/\b(free entry|free admission|no charge|free to enter)\b/i.test(hay)
  ) {
    return false;
  }

  if (/£\s*\d/.test(cost) && !/\bfree\b/.test(cost)) return false;
  if (activity.rawFacts.fee === "yes") return false;
  if (activity.rawFacts.fee === "no") return true;

  if (/\b(free entry|free admission|free to enter|no charge)\b/i.test(hay)) {
    return true;
  }

  // Explicit free in cost, or only parking mentioned as paid.
  if (/^\s*free\b/i.test(cost) || /\bfree\b/i.test(cost)) return true;
  if (!cost.trim()) {
    // Outdoor walks / parks with no admission note are treated as free.
    if (
      /walk|trail|wood|park|reservoir|moor|abbey|foss|force|falls|common/i.test(
        activity.title,
      ) ||
      activity.categories.some((c) =>
        /walk|trail|alltrails|muddy|vikings|tots|explorers/i.test(c),
      )
    ) {
      return true;
    }
    if (/pay (and|&) display|parking charge|pay to park/i.test(parking)) {
      return true;
    }
  }

  return false;
}

export function withFreeFlag(activity: Activity): Activity {
  return { ...activity, isFree: isFreeActivity(activity) };
}
