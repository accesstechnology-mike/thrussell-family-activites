import { notFound } from "next/navigation";
import { ActivityDetailClient } from "@/components/ActivityDetailClient";
import {
  buildDirectionsLinks,
  resolveDestination,
  teslaDestination,
} from "@/lib/maps";
import { getActivityById, readStore } from "@/lib/store";
import { getWeatherAt } from "@/lib/weather";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activity = await getActivityById(decodeURIComponent(id));
  if (!activity) notFound();

  const store = await readStore();
  const destination = await resolveDestination(activity);
  const directions = buildDirectionsLinks(
    activity,
    destination,
    store.originPostcode,
  );

  let weather = null;
  let weatherError = null;
  try {
    weather = await getWeatherAt(destination);
  } catch (err) {
    weatherError = err instanceof Error ? err.message : String(err);
  }

  return (
    <ActivityDetailClient
      activity={activity}
      directions={directions}
      tesla={teslaDestination(activity, destination)}
      weather={weather}
      weatherError={weatherError}
      originPostcode={store.originPostcode}
    />
  );
}
