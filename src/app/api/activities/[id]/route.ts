import { NextResponse } from "next/server";
import {
  buildDirectionsLinks,
  resolveDestination,
  teslaDestination,
} from "@/lib/maps";
import { getActivityById, readStore } from "@/lib/store";
import { getWeatherAt } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const activity = await getActivityById(id);
  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

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

  return NextResponse.json({
    activity,
    destination,
    directions,
    tesla: teslaDestination(activity, destination),
    weather,
    weatherError,
    originPostcode: store.originPostcode,
  });
}
