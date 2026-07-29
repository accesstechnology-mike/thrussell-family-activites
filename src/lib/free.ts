import type { Activity } from "./types";

/**
 * Infer whether the outing itself is free.
 *
 * - Free walk / reserve / forest with paid parking → free
 * - Paid attraction (house, zoo, show cave, NT/EH) → paid, even if parking is free
 * - "Admission is free, just pay to park" → free
 * - "Free entry for members" → paid (for the general public)
 */
export function isFreeActivity(activity: Activity): boolean {
  const cost = (activity.cost || "").trim();
  const parking = (activity.parking || "").trim();
  const summary = (activity.summary || "").trim();
  const title = activity.title || "";
  const categories = activity.categories.join(" ");
  const features = activity.features.join(" ");
  const hay = `${cost}\n${parking}\n${summary}\n${title}\n${categories}\n${features}`;

  if (activity.rawFacts?.fee === "yes") return false;
  if (activity.rawFacts?.fee === "no") return true;

  // NT / English Heritage: paid unless clearly free for everyone.
  if (
    activity.source === "national-trust" ||
    activity.source === "english-heritage"
  ) {
    return hasPublicFreeSignal(hay);
  }

  // "Admission is free, just pay to park" / free for everyone.
  if (hasPublicFreeSignal(hay)) return true;

  // Parking-only wording is never admission.
  if (isParkingOnlyCost(cost) || isParkingOnlyCost(`${cost} ${parking}`)) {
    return true;
  }

  // Membership-only free entry still means the public pays.
  if (isMembersOnlyFree(cost, summary)) return false;

  if (hasPaidAdmission(activity, cost, summary)) return false;

  if (
    /£\s*\d/.test(cost) &&
    !isParkingOnlyCost(cost) &&
    !hasPublicFreeSignal(hay) &&
    !isWalkSource(activity.source)
  ) {
    return false;
  }

  // Visitor attractions / leisure venues default to paid (before woodland-name walks).
  if (isVisitorAttraction(activity)) return false;

  // Walks, nature reserves, forests: free unless admission charged above.
  if (isOutdoorFreeDefault(activity)) return true;

  // Unknown leftovers with no clear admission signal → free.
  return true;
}

export function withFreeFlag(activity: Activity): Activity {
  const normalized = normalizeParkingOnlyCost(activity);
  return {
    ...normalized,
    isFree: isFreeActivity({ ...normalized, isFree: null }),
  };
}

function normalizeParkingOnlyCost(activity: Activity): Activity {
  const cost = (activity.cost || "").trim();
  if (!cost) return activity;

  if (hasPublicFreeSignal(cost) && /pay to park|parking/i.test(cost)) {
    const parkingNote =
      cost.match(
        /((?:just\s+)?pay to park[^.]*|parking charges?[^.]*|pay (?:and|&) display[^.]*)/i,
      )?.[1] || cost;
    return {
      ...activity,
      cost: "Free admission",
      parking: activity.parking?.trim() ? activity.parking : parkingNote.trim(),
    };
  }

  if (!isParkingOnlyCost(cost)) return activity;
  return {
    ...activity,
    cost: null,
    parking: activity.parking?.trim() ? activity.parking : cost,
  };
}

/** Free for the general public (not membership-gated). */
function hasPublicFreeSignal(hay: string): boolean {
  if (isMembersOnlyFree(hay)) return false;
  return /\b(admission is free|entry is free|free admission|free entry|free to enter|free to visit|no charge|no admission(?: charge)?|admission free|entry free|free trail)\b/i.test(
    hay,
  );
}

function isMembersOnlyFree(...chunks: string[]): boolean {
  const hay = chunks.join("\n");
  return /\bfree entry for (?:national trust )?members\b/i.test(hay);
}

function isParkingOnlyCost(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(ticket|tickets|membership)\b/i.test(t) && !/\bfree\b/i.test(t)) {
    return false;
  }
  if (/\b(admission|entry fee|entrance)\b/i.test(t) && !/\bfree\b/i.test(t)) {
    return false;
  }
  return /\b(pay to park|parking charges?|parking fees?|pay (and|&) display|just pay to park)\b/i.test(
    t,
  );
}

function hasPaidAdmission(
  activity: Activity,
  cost: string,
  summary: string,
): boolean {
  const hay = `${cost}\n${summary}`;
  if (hasPublicFreeSignal(hay)) return false;

  // Strict admission language only — avoid "entry to the gardens is 1 hour before closing"
  // and accessibility "entry via ramp".
  if (
    /\b(admission charged|admission may apply|entry fee|entrance fee|entrance charge|pay to enter|ticket\/entry price|ticket price)\b/i.test(
      hay,
    )
  ) {
    return true;
  }

  if (/\b(tickets?\s*:?\s*£|ticket\/entry\s*price\s*:?\s*£)\b/i.test(hay)) {
    return true;
  }

  // "priced at £2" on walk blogs is usually parking — ignore for walk sources.
  if (
    !isWalkSource(activity.source) &&
    /\b(priced at £|£\s*\d+(?:\.\d+)?\s*(?:per|adult|child|entry|admission))\b/i.test(
      hay,
    )
  ) {
    return true;
  }

  return false;
}

function isOutdoorFreeDefault(activity: Activity): boolean {
  if (isWalkSource(activity.source)) return true;

  if (activity.distanceMiles != null) return true;

  const title = activity.title;
  const categories = activity.categories.join(" ");
  const summary = activity.summary || "";

  if (
    /\b(walk|walks|walking|trail|trails|circular|reservoir|moor|foss|force|falls|common|beck|bank|crag|wood|woods|woodland|forest|stepping stones|nature reserve|meadow|wetland|sssi|ings)\b/i.test(
      `${title} ${categories} ${summary}`,
    )
  ) {
    return true;
  }

  if (activity.categories.some((c) => /nature reserve/i.test(c))) return true;

  return false;
}

function isWalkSource(source: string): boolean {
  return /^(reluctant-explorers|alltrails|muddy-boots-mummy|little-vikings|yorkshire-tots|teesside-family-life)$/.test(
    source,
  );
}

function isVisitorAttraction(activity: Activity): boolean {
  if (
    activity.source === "national-trust" ||
    activity.source === "english-heritage"
  ) {
    return true;
  }

  const categories = activity.categories.join(" ");
  if (
    /\b(zoo|museum|theme park|aquarium|petting farm|zoo \/ wildlife|visitor centre|swimming|water park|leisure centre|holiday park \/ resort)\b/i.test(
      categories,
    )
  ) {
    return true;
  }

  if (
    activity.source === "openstreetmap" &&
    /\battraction\b/i.test(categories) &&
    !/\bnature reserve\b/i.test(categories)
  ) {
    return true;
  }

  if (isWalkSource(activity.source)) return false;

  const title = activity.title;
  return /\b(house|hall|castle|palace|zoo|aquarium|museum|theme park|gallery|stately|manor|falconry|birds? of prey|visitor centre|maze|dungeon|brewery|farm park|walled garden|sculpture park|show cave|caverns?|swimming pool|leisure|wellbeing|wellness)\b/i.test(
    title,
  );
}
