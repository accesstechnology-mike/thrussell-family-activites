import Image from "next/image";
import Link from "next/link";

export type ActivityCardData = {
  id: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string | null;
  driveMinutes: number | null;
  terrain: string;
  features: string[];
  distanceMiles: number | null;
};

function terrainLabel(terrain: string): string {
  switch (terrain) {
    case "flat":
      return "Flat";
    case "gentle":
      return "Gentle hills";
    case "hilly":
      return "Hilly";
    case "steep":
      return "Steep";
    default:
      return "Terrain ?";
  }
}

export function ActivityCard({
  activity,
  index,
}: {
  activity: ActivityCardData;
  index: number;
}) {
  return (
    <Link
      href={`/activity/${encodeURIComponent(activity.id)}`}
      className="activity-card"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="card-media">
        {activity.imageUrl ? (
          <Image
            src={activity.imageUrl}
            alt={activity.imageAlt || activity.title}
            fill
            sizes="(max-width: 700px) 100vw, 280px"
            style={{ objectFit: "cover" }}
            unoptimized
          />
        ) : null}
      </div>
      <div className="card-body">
        <h2>{activity.title}</h2>
        <div className="meta-row">
          {activity.driveMinutes != null ? (
            <span className="pill sun">{activity.driveMinutes} min drive</span>
          ) : null}
          <span className="pill">{terrainLabel(activity.terrain)}</span>
          {activity.distanceMiles != null ? (
            <span className="pill">{activity.distanceMiles} miles</span>
          ) : null}
        </div>
        <div className="feature-tags">
          {activity.features.slice(0, 4).map((feature) => (
            <span key={feature}>{feature}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
