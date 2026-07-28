import { NextRequest, NextResponse } from "next/server";
import {
  agentApiContract,
  quickDirections,
  toSuggestActivity,
} from "@/lib/agent";
import { parseBooleanFlag, parsePositiveInt } from "@/lib/query";
import {
  buildSuggestPool,
  interpretOutingRequest,
  rankSuggestions,
} from "@/lib/suggest";
import { readStore } from "@/lib/store";
import { getWeatherAt } from "@/lib/weather";

export const runtime = "nodejs";

/**
 * Natural-language ask/suggest for Hermes.
 * Pass the user's question in `q` — no UI browsing required.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") || searchParams.get("ask") || "").trim();
  if (!q) {
    return NextResponse.json(
      {
        error: "Missing q — pass the user's question or suggestion request",
        hint: agentApiContract().examples[0],
        docs: "/api",
      },
      { status: 400 },
    );
  }

  const limitRaw = parsePositiveInt(searchParams.get("limit"));
  const limit = Math.min(Math.max(limitRaw ?? 5, 1), 25);
  const maxDriveOverride = parsePositiveInt(searchParams.get("maxDrive"));
  const includeWeather = parseBooleanFlag(searchParams.get("includeWeather"));

  const store = await readStore();
  const interpreted = interpretOutingRequest(q);

  if (maxDriveOverride != null) {
    interpreted.maxDrive = maxDriveOverride;
    interpreted.notes.push(`maxDrive overridden to ${maxDriveOverride}`);
  }

  const { pool, notes: poolNotes } = buildSuggestPool(store, interpreted);
  interpreted.notes.push(...poolNotes);

  const ranked = rankSuggestions(pool, interpreted, limit);

  const suggestions = await Promise.all(
    ranked.map(async ({ score, why, activity }) => {
      const directions = quickDirections(activity, store.originPostcode);
      let weather = null;
      let weatherError = null;
      if (includeWeather) {
        try {
          weather = await getWeatherAt(activity.coordinates);
        } catch (err) {
          weatherError = err instanceof Error ? err.message : String(err);
        }
      }
      return {
        score,
        why,
        activity: toSuggestActivity(activity),
        directions,
        weather,
        weatherError,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    ask: q,
    interpreted: {
      features: interpreted.features ?? [],
      terrains: interpreted.terrains ?? [],
      sources: interpreted.sources ?? [],
      maxDrive: interpreted.maxDrive,
      maxDistanceMiles: interpreted.maxDistanceMiles,
      freeOnly: Boolean(interpreted.freeOnly),
      residualQ: interpreted.residualQ,
      notes: interpreted.notes,
    },
    originPostcode: store.originPostcode,
    syncedAt: store.syncedAt,
    candidateCount: pool.length,
    count: suggestions.length,
    suggestions,
    next: {
      detail: "GET /api/activities/{id} for weather + precise what3words pin",
      refine: "GET /api/activities?features=...&maxDrive=...&view=card",
      docs: "/api",
    },
  });
}
