import { Suspense } from "react";
import { ActivityBrowser } from "@/components/ActivityBrowser";
import { outingKind } from "@/lib/outing-kind";
import { listActivities } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { store, activities } = await listActivities();
  const features = [
    ...new Set(store.activities.flatMap((a) => a.features)),
  ].sort((a, b) => a.localeCompare(b));

  const cards = activities.map((a) => ({
    id: a.id,
    title: a.title,
    summary: a.summary,
    imageUrl: a.imageUrl,
    imageAlt: a.imageAlt,
    driveMinutes: a.driveMinutes,
    terrain: a.terrain,
    features: a.features,
    distanceMiles: a.distanceMiles,
    isFree: a.isFree,
    kind: outingKind(a),
  }));

  return (
    <Suspense
      fallback={
        <div className="page-shell">
          <div className="empty-state">Loading outings…</div>
        </div>
      }
    >
      <ActivityBrowser
        activities={cards}
        features={features}
        syncedAt={store.syncedAt}
        originPostcode={store.originPostcode}
        maxDriveMinutes={store.maxDriveMinutes}
      />
    </Suspense>
  );
}
