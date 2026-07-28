export type OutingKind = "walk" | "attraction";

export type OutingKindFilter = "all" | "walks" | "attractions";

/** Classify an outing as a walk/trail or a visitor attraction. */
export function outingKind(activity: {
  source: string;
  title: string;
  summary?: string | null;
  categories: string[];
  distanceMiles: number | null;
}): OutingKind {
  const title = activity.title;
  const categories = activity.categories.join(" ");

  if (
    activity.source === "national-trust" ||
    activity.source === "english-heritage"
  ) {
    return "attraction";
  }

  if (activity.source === "openstreetmap") {
    if (
      /\b(zoo|museum|theme park|aquarium|petting|wildlife|gallery)\b/i.test(
        categories,
      )
    ) {
      return "attraction";
    }
    if (
      /\b(house|hall|castle|palace|manor|gallery|falconry|birds? of prey|theme park|zoo|aquarium|museum)\b/i.test(
        title,
      ) &&
      !/\b(walk|trail|circular|from|around)\b/i.test(title)
    ) {
      return "attraction";
    }
    // Nature reserves / outdoor OSM places behave as walks/outdoor.
    return "walk";
  }

  // Walk-oriented sources — treat as walks even when they visit an estate.
  if (
    /^(reluctant-explorers|alltrails|muddy-boots-mummy|little-vikings|yorkshire-tots|teesside-family-life)$/.test(
      activity.source,
    )
  ) {
    return "walk";
  }

  if (activity.distanceMiles != null) return "walk";

  if (
    /\b(walk|walks|trail|trails|circular|reservoir|moor|foss|force|falls|common|beck|bank|crag|wood|woods|woodland|stepping stones)\b/i.test(
      title,
    )
  ) {
    return "walk";
  }

  if (
    /\b(house|hall|castle|palace|zoo|aquarium|museum|theme park|gallery|manor|falconry|birds? of prey)\b/i.test(
      title,
    )
  ) {
    return "attraction";
  }

  if (
    /\b(zoo|museum|theme park|aquarium|national trust|english heritage|petting farm|attraction)\b/i.test(
      categories,
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
