import { NextRequest, NextResponse } from "next/server";
import { FEATURE_LABELS } from "@/lib/features";

export const runtime = "nodejs";

/** Minimal OpenAPI 3.1 document for agent tooling. */
export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin;
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Thrussell Outings API",
      version: "1.0.0",
      description:
        "Agent-friendly JSON API for family outings near YO7 4SQ. Prefer /api/suggest for natural-language questions.",
    },
    servers: [{ url: base }],
    paths: {
      "/api": {
        get: {
          summary: "API index + live catalogue",
          operationId: "getApiIndex",
          responses: { "200": { description: "Catalogue and endpoint docs" } },
        },
      },
      "/api/suggest": {
        get: {
          summary: "Ask / suggest outings from natural language",
          operationId: "suggestOutings",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "User question or suggestion request",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 25, default: 5 },
            },
            {
              name: "maxDrive",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
            {
              name: "includeWeather",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: { "200": { description: "Ranked suggestions with why[]" } },
        },
      },
      "/api/activities": {
        get: {
          summary: "List and filter outings",
          operationId: "listActivities",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            {
              name: "feature",
              in: "query",
              schema: { type: "string", enum: FEATURE_LABELS },
            },
            { name: "features", in: "query", schema: { type: "string" } },
            { name: "source", in: "query", schema: { type: "string" } },
            { name: "sources", in: "query", schema: { type: "string" } },
            { name: "terrain", in: "query", schema: { type: "string" } },
            { name: "terrains", in: "query", schema: { type: "string" } },
            { name: "maxDrive", in: "query", schema: { type: "integer" } },
            { name: "minDrive", in: "query", schema: { type: "integer" } },
            { name: "maxDistanceMiles", in: "query", schema: { type: "number" } },
            { name: "free", in: "query", schema: { type: "boolean" } },
            { name: "ids", in: "query", schema: { type: "string" } },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["drive", "title", "distance", "recent"],
              },
            },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            {
              name: "view",
              in: "query",
              schema: { type: "string", enum: ["card", "full"] },
            },
          ],
          responses: { "200": { description: "Filtered activity list" } },
        },
      },
      "/api/activities/{id}": {
        get: {
          summary: "Activity detail with maps, Tesla, weather",
          operationId: "getActivity",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Activity detail" },
            "404": { description: "Not found" },
          },
        },
      },
      "/api/weather": {
        get: {
          summary: "Weather for an activity or coordinates",
          operationId: "getWeather",
          parameters: [
            { name: "activityId", in: "query", schema: { type: "string" } },
            { name: "lat", in: "query", schema: { type: "number" } },
            { name: "lng", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Weather snapshot" } },
        },
      },
    },
  };

  return NextResponse.json(doc);
}
