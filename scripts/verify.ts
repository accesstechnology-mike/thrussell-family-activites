import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSuggestPool,
  interpretOutingRequest,
  rankSuggestions,
} from "../src/lib/suggest";
import type { ActivityStore } from "../src/lib/types";

async function main() {
  const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000";

  const storePath = path.join(process.cwd(), "data/activities.json");
  const storeRaw = await readFile(storePath, "utf8");
  const store = JSON.parse(storeRaw) as ActivityStore;
  if (!store.activities?.length) {
    throw new Error("Local store is empty — run npm run sync first");
  }
  console.log(`store ok: ${store.activities.length} activities`);

  const interpreted = interpretOutingRequest(
    "stepping stones under 45 minutes near a cafe",
  );
  if (!interpreted.features?.includes("stepping stones")) {
    throw new Error("NL interpret missed stepping stones");
  }
  if (interpreted.maxDrive !== 45) {
    throw new Error(`NL interpret maxDrive expected 45, got ${interpreted.maxDrive}`);
  }
  const { pool, notes } = buildSuggestPool(store, interpreted);
  const ranked = rankSuggestions(pool, interpreted, 3);
  if (!ranked.length) {
    throw new Error("Expected local suggest matches for stepping stones");
  }
  if (!ranked[0]!.activity.features.includes("stepping stones")) {
    throw new Error("Top local suggest missing stepping stones feature");
  }
  console.log(
    `suggest parse ok: ${ranked.length} hits (top: ${ranked[0]!.activity.title}${notes[0] ? `; ${notes[0]}` : ""})`,
  );

  const indexRes = await fetch(`${base}/api`);
  if (!indexRes.ok) throw new Error(`/api ${indexRes.status}`);
  const index = (await indexRes.json()) as {
    endpoints?: unknown[];
    live?: { activityCount?: number };
  };
  if (!index.endpoints?.length) throw new Error("/api missing endpoints");
  if (!index.live?.activityCount) throw new Error("/api missing live catalogue");
  console.log(`api index ok: ${index.live.activityCount} activities`);

  const llmsRes = await fetch(`${base}/llms.txt`);
  if (!llmsRes.ok) throw new Error(`/llms.txt ${llmsRes.status}`);
  const llms = await llmsRes.text();
  if (!/\/api\/suggest/i.test(llms)) throw new Error("llms.txt missing suggest path");
  console.log("llms.txt ok");

  const suggestRes = await fetch(
    `${base}/api/suggest?q=${encodeURIComponent("stepping stones under 45 minutes")}&limit=3`,
  );
  if (!suggestRes.ok) throw new Error(`/api/suggest ${suggestRes.status}`);
  const suggest = (await suggestRes.json()) as {
    count: number;
    suggestions: Array<{
      why: string[];
      activity: { id: string; postcode?: string | null };
      directions?: { googleMapsDirections?: string; tesla?: string };
    }>;
    interpreted?: { features?: string[]; maxDrive?: number | null };
  };
  if (!suggest.count) throw new Error("suggest returned zero results");
  if (!suggest.interpreted?.features?.includes("stepping stones")) {
    throw new Error("suggest did not interpret stepping stones");
  }
  if (suggest.interpreted.maxDrive !== 45) {
    throw new Error("suggest did not interpret 45 min drive cap");
  }
  const top = suggest.suggestions[0]!;
  if (!top.directions?.googleMapsDirections?.includes("google.com/maps")) {
    throw new Error("suggest missing Google Maps directions");
  }
  if (!top.directions.tesla) throw new Error("suggest missing Tesla destination");
  if (!top.why?.length) throw new Error("suggest missing why reasons");
  console.log(`api suggest ok: ${suggest.count} (top: ${top.activity.id.slice(0, 48)}…)`);

  const listRes = await fetch(
    `${base}/api/activities?features=stepping%20stones&maxDrive=60&view=card&limit=5`,
  );
  if (!listRes.ok) throw new Error(`/api/activities ${listRes.status}`);
  const list = (await listRes.json()) as {
    count: number;
    total: number;
    activities: Array<{
      id: string;
      postcode?: string | null;
      coordinates?: { lat: number; lng: number };
      sourceUrl?: string;
    }>;
  };
  if (!list.count) throw new Error("API returned zero filtered activities");
  const sample = list.activities[0]!;
  if (!sample.coordinates) throw new Error("card view missing coordinates");
  if (!sample.sourceUrl) throw new Error("card view missing sourceUrl");
  console.log(`api list ok: ${list.count}/${list.total} with logistics fields`);

  const id = sample.id;
  const detailRes = await fetch(`${base}/api/activities/${encodeURIComponent(id)}`);
  if (!detailRes.ok) throw new Error(`/api/activities/[id] ${detailRes.status}`);
  const detail = (await detailRes.json()) as {
    directions?: { googleMapsDirections?: string };
    tesla?: string;
    weather?: { condition?: string } | null;
  };
  if (!detail.directions?.googleMapsDirections?.includes("google.com/maps")) {
    throw new Error("Missing Google Maps directions link");
  }
  if (!detail.tesla) throw new Error("Missing Tesla destination");
  console.log(`api detail ok: maps + tesla${detail.weather ? " + weather" : ""}`);

  const openapiRes = await fetch(`${base}/api/openapi.json`);
  if (!openapiRes.ok) throw new Error(`/api/openapi.json ${openapiRes.status}`);
  const openapi = (await openapiRes.json()) as { openapi?: string; paths?: object };
  if (!openapi.openapi?.startsWith("3.")) throw new Error("openapi version missing");
  if (!openapi.paths || !("/api/suggest" in openapi.paths)) {
    throw new Error("openapi missing /api/suggest");
  }
  console.log("openapi ok");

  const homeRes = await fetch(base);
  if (!homeRes.ok) throw new Error(`home ${homeRes.status}`);
  const html = await homeRes.text();
  if (!/Thrussell Outings|Choose an outing/i.test(html)) {
    throw new Error("Home page missing expected kid-facing copy");
  }
  console.log("home ok");
  console.log("verify passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
