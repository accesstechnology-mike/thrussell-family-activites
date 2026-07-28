"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEFAULT_FILTERS,
  homeHrefFromFilters,
  readStoredFilters,
} from "@/lib/filter-state";
import { detailImageUrl } from "@/lib/image-urls";
import type { Activity, DirectionsLinks, WeatherSnapshot } from "@/lib/types";

type Props = {
  activity: Activity;
  directions: DirectionsLinks;
  tesla: string;
  weather: WeatherSnapshot | null;
  weatherError: string | null;
  originPostcode: string;
};

function terrainLabel(terrain: string): string {
  switch (terrain) {
    case "flat":
      return "Flat / easy underfoot";
    case "gentle":
      return "Gentle ups and downs";
    case "hilly":
      return "Hilly";
    case "steep":
      return "Steep in places";
    default:
      return "Check the notes";
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "reluctant-explorers":
      return "The Reluctant Explorers";
    case "national-trust":
      return "National Trust";
    case "english-heritage":
      return "English Heritage";
    case "yorkshire-tots":
      return "Yorkshire Tots to Teens";
    case "teesside-family-life":
      return "Teesside Family Life";
    case "muddy-boots-mummy":
      return "Muddy Boots Mummy";
    case "little-vikings":
      return "Little Vikings";
    case "alltrails":
      return "AllTrails";
    case "openstreetmap":
      return "OpenStreetMap";
    default:
      return source.replace(/-/g, " ");
  }
}

function ExpandableText({
  label,
  text,
  collapseAt = 160,
}: {
  label: string;
  text: string;
  collapseAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > collapseAt;
  const shown = !long || open ? text : `${text.slice(0, collapseAt).trim()}…`;

  return (
    <div className="note-block">
      <div className="note-label">{label}</div>
      <p className="note-body">{shown}</p>
      {long ? (
        <button
          type="button"
          className="note-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

export function ActivityDetailClient({
  activity,
  directions,
  tesla,
  weather,
  weatherError,
  originPostcode,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [backHref, setBackHref] = useState("/");
  const image = detailImageUrl(activity);

  useEffect(() => {
    setBackHref(homeHrefFromFilters(readStoredFilters() ?? DEFAULT_FILTERS));
  }, []);

  async function copyTesla() {
    try {
      await navigator.clipboard.writeText(tesla);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="page-shell">
      <Link href={backHref} className="back-link">
        ← Back to outings
      </Link>

      <div className="detail-layout">
        <section className="detail-panel">
          <div className="detail-hero" data-has-image={Boolean(image)}>
            {image ? (
              <Image
                src={image}
                alt={activity.imageAlt || activity.title}
                width={1200}
                height={800}
                unoptimized={image.startsWith("/media/")}
                priority
              />
            ) : (
              <div className="detail-hero-fallback" aria-hidden>
                <span>{activity.title}</span>
              </div>
            )}
            {activity.isFree ? <span className="free-badge">Free activity</span> : null}
          </div>

          <h1>{activity.title}</h1>
          <p className="summary">{activity.summary}</p>

          <div className="feature-tags" style={{ marginBottom: "1rem" }}>
            {activity.features.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>

          <dl className="fact-grid fact-grid-compact">
            <div className="fact">
              <dt>Drive</dt>
              <dd>
                {activity.driveMinutes != null
                  ? `${activity.driveMinutes} min from ${originPostcode}`
                  : "Unknown"}
              </dd>
            </div>
            <div className="fact">
              <dt>Terrain</dt>
              <dd>{terrainLabel(activity.terrain)}</dd>
            </div>
            <div className="fact">
              <dt>Walk length</dt>
              <dd>
                {activity.distanceMiles != null
                  ? `${activity.distanceMiles} miles`
                  : "See source"}
              </dd>
            </div>
            <div className="fact">
              <dt>Cost</dt>
              <dd>
                {activity.isFree
                  ? "Free activity"
                  : activity.cost ?? "See source"}
              </dd>
            </div>
            <div className="fact">
              <dt>Weather now</dt>
              <dd>
                {weather
                  ? `${weather.condition}, ${weather.temperatureC}°C${
                      weather.precipitationChance != null
                        ? ` · ${weather.precipitationChance}% rain`
                        : ""
                    }`
                  : weatherError || "Unavailable"}
              </dd>
            </div>
            {activity.postcode ? (
              <div className="fact">
                <dt>Postcode</dt>
                <dd>{activity.postcode}</dd>
              </div>
            ) : null}
          </dl>

          <div className="note-stack">
            {activity.parking ? (
              <ExpandableText label="Parking" text={activity.parking} />
            ) : null}
            {activity.terrainNotes ? (
              <ExpandableText label="Terrain notes" text={activity.terrainNotes} />
            ) : null}
            {activity.rawFacts.openingHours ? (
              <ExpandableText
                label="Opening hours"
                text={activity.rawFacts.openingHours}
                collapseAt={120}
              />
            ) : null}
            {activity.cost && !activity.isFree ? (
              <ExpandableText label="Cost details" text={activity.cost} collapseAt={120} />
            ) : null}
          </div>

          <div className="source-row">
            <a
              className="action-btn secondary source-btn"
              href={activity.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open original source — {sourceLabel(activity.source)}
            </a>
            {activity.locationLabel ? (
              <p className="lede source-meta">{activity.locationLabel}</p>
            ) : null}
          </div>
        </section>

        <aside className="parent-panel">
          <h2>Grown-up go button</h2>
          <p className="lede">
            Open Google Maps on your phone, or paste the destination into the Tesla.
          </p>

          <div className="action-stack">
            <a
              className="action-btn primary"
              href={directions.googleMapsDirections}
              target="_blank"
              rel="noreferrer"
            >
              Navigate in Google Maps
            </a>
            <a
              className="action-btn secondary"
              href={directions.googleMaps}
              target="_blank"
              rel="noreferrer"
            >
              Open place pin
            </a>
            <a
              className="action-btn secondary"
              href={directions.appleMaps}
              target="_blank"
              rel="noreferrer"
            >
              Open in Apple Maps
            </a>
            <button type="button" className="action-btn ghost" onClick={copyTesla}>
              {copied ? "Copied for Tesla" : "Copy for Tesla"}
            </button>
            <a
              className="action-btn ghost"
              href={activity.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Original guide / website
            </a>
          </div>

          <div className="tesla-box" aria-label="Tesla destination">
            {tesla}
          </div>

          {activity.what3words ? (
            <p className="lede" style={{ marginTop: "0.85rem" }}>
              Parking what3words:{" "}
              <strong>///{activity.what3words}</strong>
              {activity.postcode ? ` · postcode ${activity.postcode}` : null}
            </p>
          ) : activity.postcode ? (
            <p className="lede" style={{ marginTop: "0.85rem" }}>
              Postcode: <strong>{activity.postcode}</strong>
            </p>
          ) : null}

          {activity.rawFacts.phone ? (
            <p className="lede" style={{ marginTop: "0.55rem" }}>
              Phone:{" "}
              <a href={`tel:${activity.rawFacts.phone.replace(/\s+/g, "")}`}>
                {activity.rawFacts.phone}
              </a>
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
