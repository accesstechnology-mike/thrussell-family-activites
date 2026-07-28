import type { Activity } from "./types";

/**
 * Infer whether the outing itself is free.
 *
 * Rules:
 * - Free walk / outdoor trail with paid parking → free
 * - Paid attraction / house / zoo (entry fee) with free parking → paid
 * - Parking-only cost wording ("just pay to park") never makes something paid
 *
 * Always recomputes from source fields — never trusts a previously stored flag.
 */
export function isFreeActivity(activity: Activity): boolean {
  const cost = (activity.cost || "").trim();
  const parking = (activity.parking || "").trim();
  const summary = (activity.summary || "").trim();
  const title = activity.title || "";
  const categoryBlob = activity.categories.join(" ");
  const featureBlob = activity.features.join(" ");
  const hay = `${cost}\n${parking}\n${summary}\n${title}\n${categoryBlob}\n${featureBlob}`;

  // Explicit OSM fee tags win.
  if (activity.rawFacts?.fee === "yes") return false;
  if (activity.rawFacts?.fee === "no") return true;

  if (hasFreeEntrySignal(hay)) return true;

  // "Just pay to park" / parking charges alone are NOT admission.
  if (isParkingOnlyCost(cost) && !hasAdmissionSignal(summary, title, categoryBlob)) {
    return true;
  }

  if (hasAdmissionSignal(cost, summary, title, categoryBlob, featureBlob)) {
    return false;
  }

  if (/£\s*\d/.test(cost) && !isParkingOnlyCost(cost)) {
    return false;
  }

  // Visitor attractions / houses default to paid unless marked free above.
  if (isPaidVenueType(activity)) {
    return false;
  }

  // Walks, trails, outdoor listicle sources default to free.
  if (isWalkLike(activity)) {
    return true;
  }

  // Parking notes alone still imply the outing itself is free.
  if (isParkingOnlyCost(`${cost} ${parking}`)) {
    return true;
  }

  return false;
}

export function withFreeFlag(activity: Activity): Activity {
  const normalized = normalizeParkingOnlyCost(activity);
  return {
    ...normalized,
    isFree: isFreeActivity({ ...normalized, isFree: null }),
  };
}

/** Move "just pay to park" style wording out of cost into parking. */
function normalizeParkingOnlyCost(activity: Activity): Activity {
  const cost = (activity.cost || "").trim();
  if (!cost || !isParkingOnlyCost(cost)) return activity;
  return {
    ...activity,
    cost: null,
    parking: activity.parking?.trim() ? activity.parking : cost,
  };
}

function hasFreeEntrySignal(hay: string): boolean {
  return /\b(free entry|free admission|free to enter|no charge|no admission|admission free)\b/i.test(
    hay,
  );
}

function isParkingOnlyCost(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /\b(admission|entry fee|entrance fee|ticket|tickets|membership)\b/i.test(t)
  ) {
    return false;
  }
  return /\b(pay to park|parking charges?|parking fees?|pay (and|&) display|just pay to park|parking)\b/i.test(
    t,
  );
}

function hasAdmissionSignal(...chunks: string[]): boolean {
  const hay = chunks.join("\n");
  return /\b(admission|entry fee|entrance fee|entrance charge|ticket|tickets|pay to enter|membership \/ admission|admission charged|admission may apply)\b/i.test(
    hay,
  );
}

function isPaidVenueType(activity: Activity): boolean {
  if (
    activity.source === "national-trust" ||
    activity.source === "english-heritage"
  ) {
    return true;
  }

  const title = activity.title;
  if (
    /\b(house|hall|castle|palace|zoo|aquarium|museum|theme park|gallery|stately|manor|falconry|birds? of prey)\b/i.test(
      title,
    )
  ) {
    // "City Hall" walks etc. are rare; "Hall" on its own in walk titles still
    // often means a paid estate — keep paid unless clearly a walk-only title.
    if (
      /\b(walk|trail|circular|from|around)\b/i.test(title) &&
      !/\b(house|palace|zoo|aquarium|museum|theme park|gallery|manor)\b/i.test(
        title,
      )
    ) {
      return false;
    }
    return true;
  }

  return activity.categories.some((c) =>
    /\b(zoo|museum|theme park|aquarium|national trust|english heritage|petting farm|zoo \/ wildlife)\b/i.test(
      c,
    ),
  );
}

function isWalkLike(activity: Activity): boolean {
  if (activity.distanceMiles != null) return true;

  if (
    /\b(walk|walks|trail|trails|circular|reservoir|moor|foss|force|falls|common|beck|bank|crag|wood|woods|woodland|stepping stones)\b/i.test(
      activity.title,
    )
  ) {
    return true;
  }

  return activity.categories.some((c) =>
    /\b(walk|trail|alltrails|muddy|vikings|tots|explorers|reluctant)\b/i.test(c),
  );
}
