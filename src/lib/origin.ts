import { HOME_POSTCODE, USER_AGENT } from "./config";
import type { LatLng } from "./types";

export type Origin = {
  postcode: string;
  location: LatLng;
  adminDistrict: string | null;
};

/**
 * Live geocode of the home postcode via postcodes.io.
 * Coordinates are never hardcoded.
 */
export async function getOrigin(): Promise<Origin> {
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(HOME_POSTCODE)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!res.ok) {
    throw new Error(`Failed to geocode home postcode (${res.status})`);
  }

  const data = (await res.json()) as {
    status: number;
    result?: {
      latitude: number;
      longitude: number;
      admin_district?: string;
      postcode?: string;
    };
  };

  if (
    data.status !== 200 ||
    !data.result ||
    typeof data.result.latitude !== "number" ||
    typeof data.result.longitude !== "number"
  ) {
    throw new Error("postcodes.io returned no coordinates for home");
  }

  return {
    postcode: data.result.postcode ?? HOME_POSTCODE,
    location: {
      lat: data.result.latitude,
      lng: data.result.longitude,
    },
    adminDistrict: data.result.admin_district ?? null,
  };
}
