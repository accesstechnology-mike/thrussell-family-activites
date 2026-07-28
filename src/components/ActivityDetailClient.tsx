"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
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

export function ActivityDetailClient({
  activity,
  directions,
  tesla,
  weather,
  weatherError,
  originPostcode,
}: Props) {
  const [copied, setCopied] = useState(false);

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
      <Link href="/" className="back-link">
        ← Back to outings
      </Link>

      <div className="detail-layout">
        <section className="detail-panel">
          <div className="detail-hero" style={{ marginBottom: "1rem" }}>
            {activity.imageUrl ? (
              <Image
                src={activity.imageUrl}
                alt={activity.imageAlt || activity.title}
                width={1200}
                height={800}
                unoptimized
                priority
              />
            ) : null}
          </div>

          <h1>{activity.title}</h1>
          <p className="summary">{activity.summary}</p>

          <div className="feature-tags" style={{ marginBottom: "1rem" }}>
            {activity.features.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>

          <dl className="fact-grid">
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
              <dd>{activity.cost ?? "See source / often free outdoors"}</dd>
            </div>
            <div className="fact">
              <dt>Parking</dt>
              <dd>{activity.parking ?? "Check the source page"}</dd>
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
          </dl>

          {activity.terrainNotes ? (
            <p className="summary" style={{ marginTop: "1rem" }}>
              <strong>Terrain notes:</strong> {activity.terrainNotes}
            </p>
          ) : null}

          <p className="summary" style={{ marginTop: "0.8rem" }}>
            Source:{" "}
            <a href={activity.sourceUrl} target="_blank" rel="noreferrer">
              {activity.source.replace(/-/g, " ")}
            </a>
            {activity.locationLabel ? ` · ${activity.locationLabel}` : null}
          </p>
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
            <button type="button" className="action-btn ghost" onClick={copyTesla}>
              {copied ? "Copied for Tesla" : "Copy for Tesla"}
            </button>
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
        </aside>
      </div>
    </div>
  );
}
