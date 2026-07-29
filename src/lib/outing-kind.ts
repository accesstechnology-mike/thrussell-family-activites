export type OutingKind = "walk" | "attraction";

export type OutingKindFilter = "all" | "walks" | "attractions";

/** Classify an outing as a walk/trail/outdoor place or a visitor attraction. */
export function outingKind(activity: {
  source: string;
  title: string;
  summary?: string | null;
  cost?: string | null;
  categories: string[];
  distanceMiles: number | null;
}): OutingKind {
  const title = activity.title;
  const categories = activity.categories.join(" ");
  const summary = activity.summary || "";
  const cost = activity.cost || "";
  const blob = `${title}\n${categories}\n${summary}\n${cost}`;

  if (
    activity.source === "national-trust" ||
    activity.source === "english-heritage"
  ) {
    return "attraction";
  }

  if (activity.source === "openstreetmap") {
    if (/\bnature reserve\b/i.test(categories) || /\bnature reserve\b/i.test(summary)) {
      return "walk";
    }
    if (
      /\b(zoo|museum|theme park|aquarium|petting|wildlife|gallery|attraction|swimming|water park|leisure centre|holiday park|resort)\b/i.test(
        categories,
      )
    ) {
      return "attraction";
    }
    if (
      /\b(house|hall|castle|palace|manor|gallery|falconry|birds? of prey|theme park|zoo|aquarium|museum|visitor centre|maze|dungeon|brewery|farm park|walled garden|sculpture park|railway|caverns?|priory|arbour?etum|arboretum|swimming pool|leisure|wellbeing|wellness)\b/i.test(
        title,
      )
    ) {
      return "attraction";
    }
    return "walk";
  }

  // Walk-oriented sources stay walks (including estate walks / free trails).
  if (
    /^(reluctant-explorers|alltrails|muddy-boots-mummy|little-vikings|yorkshire-tots|teesside-family-life)$/.test(
      activity.source,
    )
  ) {
    // Ticketed adventure parks from walk blogs → attractions.
    if (
      /\b(farm park|theme park|zoo|aquarium|dungeon)\b/i.test(blob) &&
      !/\b(walk|walking|circular|trails?)\b/i.test(title)
    ) {
      return "attraction";
    }
    if (
      /\badventure trail\b/i.test(title) &&
      /\b(ticket|£\d|entry price)\b/i.test(blob) &&
      !/\bfree\b/i.test(blob)
    ) {
      return "attraction";
    }
    return "walk";
  }

  if (activity.distanceMiles != null) return "walk";

  if (
    /\b(walk|walks|trail|trails|circular|reservoir|moor|foss|force|falls|common|beck|bank|crag|wood|woods|woodland|forest|stepping stones|nature reserve)\b/i.test(
      blob,
    )
  ) {
    return "walk";
  }

  if (
    /\b(house|hall|castle|palace|zoo|aquarium|museum|theme park|gallery|manor|falconry|birds? of prey|attraction|swimming pool|leisure centre|water park|wild swim)\b/i.test(
      blob,
    )
  ) {
    return "attraction";
  }

  return "walk";
}

export function matchesOutingKindFilter(
  kind: OutingKind,
  filter: OutingKindFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "walks") return kind === "walk";
  return kind === "attraction";
}
