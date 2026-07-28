import type { OutingKindFilter } from "./outing-kind";

export const FILTER_STORAGE_KEY = "thrussell-outings-filters";

export type BrowseFilters = {
  kind: OutingKindFilter;
  freeOnly: boolean;
  feature: string | null;
  query: string;
};

export const DEFAULT_FILTERS: BrowseFilters = {
  kind: "all",
  freeOnly: false,
  feature: null,
  query: "",
};

export function filtersToSearchParams(filters: BrowseFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.freeOnly) params.set("free", "1");
  if (filters.feature) params.set("feature", filters.feature);
  if (filters.query.trim()) params.set("q", filters.query.trim());
  return params;
}

export function filtersFromSearchParams(
  params: URLSearchParams,
): BrowseFilters {
  const kindRaw = params.get("kind");
  const kind: OutingKindFilter =
    kindRaw === "walks" || kindRaw === "attractions" ? kindRaw : "all";
  return {
    kind,
    freeOnly: params.get("free") === "1" || params.get("freeOnly") === "1",
    feature: params.get("feature"),
    query: params.get("q") ?? "",
  };
}

export function homeHrefFromFilters(filters: BrowseFilters): string {
  const qs = filtersToSearchParams(filters).toString();
  return qs ? `/?${qs}` : "/";
}

export function readStoredFilters(): BrowseFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseFilters>;
    const kind =
      parsed.kind === "walks" || parsed.kind === "attractions"
        ? parsed.kind
        : "all";
    return {
      kind,
      freeOnly: Boolean(parsed.freeOnly),
      feature: parsed.feature ?? null,
      query: typeof parsed.query === "string" ? parsed.query : "",
    };
  } catch {
    return null;
  }
}

export function writeStoredFilters(filters: BrowseFilters): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota / private mode
  }
}
