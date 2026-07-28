"use client";

import { useMemo, useState } from "react";
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
  const [query, setQuery] = useState("");
  const [feature, setFeature] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activities.filter((a) => {
      if (freeOnly && !a.isFree) return false;
      if (feature && !a.features.includes(feature)) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.features.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [activities, feature, freeOnly, query]);

  const syncedLabel = syncedAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      }).format(new Date(syncedAt))
    : "not synced yet";

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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search outings"
        />
        <div className="filter-bar">
          <label className="toggle">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => setFreeOnly(e.target.checked)}
            />
            <span>Free activities only</span>
          </label>
        </div>
        <div className="chip-row" role="listbox" aria-label="Filter by fun bits">
          <button
            type="button"
            className="chip"
            data-active={feature === null}
            onClick={() => setFeature(null)}
          >
            All the fun
          </button>
          {features.slice(0, 12).map((f) => (
            <button
              key={f}
              type="button"
              className="chip"
              data-active={feature === f}
              onClick={() => setFeature(feature === f ? null : f)}
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
