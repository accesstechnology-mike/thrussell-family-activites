import { ActivityBrowser } from "@/components/ActivityBrowser";
import { listActivities } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { store, activities } = await listActivities();
  const features = [
    ...new Set(store.activities.flatMap((a) => a.features)),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <ActivityBrowser
      activities={activities.map((a) => ({
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
      }))}
      features={features}
      syncedAt={store.syncedAt}
      originPostcode={store.originPostcode}
      maxDriveMinutes={store.maxDriveMinutes}
    />
  );
}
