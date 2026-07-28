import { NextRequest, NextResponse } from "next/server";
import { getActivityById } from "@/lib/store";
import { getWeatherAt } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("activityId");
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));

  try {
    if (id) {
      const activity = await getActivityById(id);
      if (!activity) {
        return NextResponse.json({ error: "Activity not found" }, { status: 404 });
      }
      const weather = await getWeatherAt(activity.coordinates);
      return NextResponse.json({ weather });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: "Provide activityId or lat/lng" },
        { status: 400 },
      );
    }

    const weather = await getWeatherAt({ lat, lng });
    return NextResponse.json({ weather });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
