import { USER_AGENT } from "./config";
import type { LatLng, WeatherSnapshot } from "./types";

function conditionFromCode(code: number): string {
  const map: Record<number, string> = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Foggy",
    48: "Foggy",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    95: "Thunderstorms",
  };
  return map[code] ?? "Unknown";
}

/** Live weather at destination coordinates via Open-Meteo. */
export async function getWeatherAt(location: LatLng): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lng),
    current:
      "temperature_2m,weather_code,precipitation_probability,wind_speed_10m",
    wind_speed_unit: "mph",
    timezone: "Europe/London",
  });

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 30 * 60 },
    },
  );

  if (!res.ok) {
    throw new Error(`Open-Meteo weather request failed (${res.status})`);
  }

  const data = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      precipitation_probability?: number | null;
      wind_speed_10m?: number | null;
    };
  };

  const current = data.current;
  if (!current || typeof current.temperature_2m !== "number") {
    throw new Error("Open-Meteo returned no current weather");
  }

  return {
    temperatureC: Math.round(current.temperature_2m),
    condition: conditionFromCode(current.weather_code ?? -1),
    precipitationChance:
      typeof current.precipitation_probability === "number"
        ? current.precipitation_probability
        : null,
    windMph:
      typeof current.wind_speed_10m === "number"
        ? Math.round(current.wind_speed_10m)
        : null,
    fetchedAt: new Date().toISOString(),
  };
}
