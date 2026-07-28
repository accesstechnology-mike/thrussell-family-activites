"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  readStoredFilters,
  writeStoredFilters,
  type BrowseFilters,
} from "@/lib/filter-state";
import {
  matchesOutingKindFilter,
  type OutingKindFilter,
} from "@/lib/outing-kind";
import { ActivityCard, type ActivityCardData } from "./ActivityCard";

type Props = {
  activities: ActivityCardData[];
  features: string[];
  syncedAt: string | null;
  originPostcode: string;
  maxDriveMinutes: number;
};

export function ActivityBrowser({
  activities,
  features,
  syncedAt,
  originPostcode,
  maxDriveMinutes,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydrated = useRef(false);

  const [filters, setFilters] = useState<BrowseFilters>(() => {
    if (searchParams.toString()) {
      return filtersFromSearchParams(searchParams);
    }
    return DEFAULT_FILTERS;
  });

  // Restore from sessionStorage when landing on bare "/", then keep URL in sync.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const fromUrl = filtersFromSearchParams(searchParams);
    const urlHasFilters = searchParams.toString().length > 0;
    if (urlHasFilters) {
      setFilters(fromUrl);
      writeStoredFilters(fromUrl);
      return;
    }

    const stored = readStoredFilters();
    if (stored && hasActiveFilters(stored)) {
      setFilters(stored);
      const qs = filtersToSearchParams(stored).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!hydrated.current) return;
    writeStoredFilters(filters);
    const qs = filtersToSearchParams(filters).toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    const current = searchParams.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    if (next !== current) {
      router.replace(next, { scroll: false });
    }
  }, [filters, pathname, router, searchParams]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return activities.filter((a) => {
      if (!matchesOutingKindFilter(a.kind, filters.kind)) return false;
      if (filters.freeOnly && !a.isFree) return false;
      if (filters.feature && !a.features.includes(filters.feature)) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.features.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [activities, filters]);

  const counts = useMemo(() => {
    let walks = 0;
    let attractions = 0;
    for (const a of activities) {
      if (a.kind === "walk") walks += 1;
      else attractions += 1;
    }
    return { walks, attractions, all: activities.length };
  }, [activities]);

  const syncedLabel = syncedAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      }).format(new Date(syncedAt))
    : "not synced yet";

  function setKind(kind: OutingKindFilter) {
    setFilters((prev) => ({ ...prev, kind }));
  }

  return (
    <div className="page-shell">
      <header className="brand-hero">
        <div className="brand-mark">Thrussell Outings</div>
        <p>Pick today&apos;s adventure — pictures, fun bits, then maps for grown-ups.</p>
      </header>

      <div className="controls">
        <input
          className="search-input"
          type="search"
          placeholder="Search caves, ice cream, stepping stones…"
          value={filters.query}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, query: e.target.value }))
          }
          aria-label="Search outings"
        />

        <div
          className="kind-row"
          role="tablist"
          aria-label="Walks or visitor attractions"
        >
          <button
            type="button"
            role="tab"
            className="kind-chip"
            aria-selected={filters.kind === "all"}
            data-active={filters.kind === "all"}
            onClick={() => setKind("all")}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            role="tab"
            className="kind-chip"
            aria-selected={filters.kind === "walks"}
            data-active={filters.kind === "walks"}
            onClick={() => setKind("walks")}
          >
            Walks ({counts.walks})
          </button>
          <button
            type="button"
            role="tab"
            className="kind-chip"
            aria-selected={filters.kind === "attractions"}
            data-active={filters.kind === "attractions"}
            onClick={() => setKind("attractions")}
          >
            Visitor attractions ({counts.attractions})
          </button>
        </div>

        <div className="filter-bar">
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.freeOnly}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, freeOnly: e.target.checked }))
              }
            />
            <span>Free activities only</span>
          </label>
        </div>

        <div className="chip-row" role="listbox" aria-label="Filter by fun bits">
          <button
            type="button"
            className="chip"
            data-active={filters.feature === null}
            onClick={() => setFilters((prev) => ({ ...prev, feature: null }))}
          >
            All the fun
          </button>
          {features.slice(0, 12).map((f) => (
            <button
              key={f}
              type="button"
              className="chip"
              data-active={filters.feature === f}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  feature: prev.feature === f ? null : f,
                }))
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          No outings match that yet. Try another filter, or ask a grown-up to sync.
        </div>
      ) : (
        <div className="activity-grid">
          {filtered.map((activity, index) => (
            <ActivityCard key={activity.id} activity={activity} index={index} />
          ))}
        </div>
      )}

      <footer className="status-bar">
        {filtered.length} outings within ~{maxDriveMinutes} min of {originPostcode}.
        Last sync: {syncedLabel}. Auto-refreshes daily (~06:00 UTC via{" "}
        <code>/api/sync</code>); grown-ups can also run <code>npm run sync</code>.
      </footer>
    </div>
  );
}

function hasActiveFilters(filters: BrowseFilters): boolean {
  return (
    filters.kind !== "all" ||
    filters.freeOnly ||
    Boolean(filters.feature) ||
    Boolean(filters.query.trim())
  );
}
