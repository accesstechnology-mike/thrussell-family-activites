import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import {
  cleanPlacePhrase,
  geocodeQueryVariants,
  nominatimNameFitsQuery,
} from "../src/lib/geocode";
import { extractOsGridRef, osGridToWgs84 } from "../src/lib/os-grid";
import {
  extractLocationHints,
  extractPageLatLng,
  resolvePageLocation,
} from "../src/lib/page-location";
import { haversineKm } from "../src/lib/sources/listicle";
import {
  buildSuggestPool,
  interpretOutingRequest,
  rankSuggestions,
} from "../src/lib/suggest";
import type { ActivityStore } from "../src/lib/types";

/** Snippets from the live Where2walk start-point chrome (not invented). */
const SKIPTON_PAGE_SNIPPET = `<script>var lat = 53.960328;
  var lng = -1.9977950;</script>
<div class="more-list"><h5>Start point</h5>
<p>Location: <strong>Skipton</strong></p>
<p>Grid ref: <strong>SE 003511</strong></p></div>`;

const CALF_PAGE_SNIPPET = `<script>var lat = 54.23634;
  var lng = -2.582474;</script>
<div class="more-list"><h5>Start point</h5>
<p>Location: <strong>Barbon</strong></p>
<p>Grid ref: <strong>SD 628825</strong></p></div>`;

const GRID_ONLY_SNIPPET =
  `<p>Start point</p><p>Grid ref: <strong>SE 003511</strong></p>`;

async function main() {
  const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000";

  const storePath = path.join(process.cwd(), "data/activities.json");
  const storeRaw = await readFile(storePath, "utf8");
  const store = JSON.parse(storeRaw) as ActivityStore;
  if (!store.activities?.length) {
    throw new Error("Local store is empty — run npm run sync first");
  }
  console.log(`store ok: ${store.activities.length} activities`);

  const skiVariants = geocodeQueryVariants("Walk on Skipton Moor, Yorkshire, UK");
  if (!skiVariants.some((v) => /^skipton moor\b/i.test(v))) {
    throw new Error("geocode variants should try 'Skipton Moor', not only the walk title");
  }
  if (skiVariants.some((v) => /^on skipton\b/i.test(v))) {
    throw new Error("geocode variants must not emit 'on Skipton' (Skipton-on-Swale homonym)");
  }
  if (cleanPlacePhrase("Walk on Skipton Moor, Yorkshire, UK") !== "Skipton Moor") {
    throw new Error("cleanPlacePhrase should strip Walk/on/region from Skipton Moor");
  }
  if (nominatimNameFitsQuery("Skipton Moor", "Skipton-on-Swale")) {
    throw new Error("Skipton-on-Swale must not match query Skipton Moor");
  }
  if (nominatimNameFitsQuery("Calf Top", "Calf Close Top")) {
    throw new Error("Calf Close Top (Dishforth meadow) must not match Calf Top");
  }
  if (!nominatimNameFitsQuery("Calf Top and Barbondale", "Calf Top")) {
    throw new Error("Calf Top should match the Calf Top / Barbondale title");
  }
  console.log("geocode variant / match rules ok (title geocode is last resort)");

  const skiSnippet = extractPageLatLng(SKIPTON_PAGE_SNIPPET);
  const calfSnippet = extractPageLatLng(CALF_PAGE_SNIPPET);
  if (!skiSnippet || !calfSnippet) {
    throw new Error("Failed to extract var lat/lng from Where2walk start snippets");
  }
  const skiHints = extractLocationHints(SKIPTON_PAGE_SNIPPET);
  const calfHints = extractLocationHints(CALF_PAGE_SNIPPET);
  if (skiHints.gridRef !== "SE 003 511" || calfHints.gridRef !== "SD 628 825") {
    throw new Error(
      `OS grid extract expected SE 003 511 / SD 628 825, got ${skiHints.gridRef} / ${calfHints.gridRef}`,
    );
  }
  const skiFromPage = await resolvePageLocation({ html: SKIPTON_PAGE_SNIPPET });
  const calfFromPage = await resolvePageLocation({ html: CALF_PAGE_SNIPPET });
  if (skiFromPage?.coordSource !== "page-latlng") {
    throw new Error(`Skipton snippet resolved via ${skiFromPage?.coordSource}, not page-latlng`);
  }
  if (calfFromPage?.coordSource !== "page-latlng") {
    throw new Error(`Calf Top snippet resolved via ${calfFromPage?.coordSource}, not page-latlng`);
  }
  const gridOnly = await resolvePageLocation({ html: GRID_ONLY_SNIPPET });
  if (gridOnly?.coordSource !== "os-grid") {
    throw new Error(`Grid-only snippet resolved via ${gridOnly?.coordSource}, not os-grid`);
  }
  const skiGrid = osGridToWgs84(extractOsGridRef(SKIPTON_PAGE_SNIPPET) ?? "");
  if (!skiGrid || haversineKm(skiFromPage, skiGrid) > 1) {
    throw new Error("SE 003511 did not convert near the Skipton Moor page pin");
  }
  console.log(
    `page location order ok: Skipton ${skiFromPage.coordSource} ${skiFromPage.lat},${skiFromPage.lng}; Calf ${calfFromPage.coordSource} ${calfFromPage.lat},${calfFromPage.lng}`,
  );

  const skiLivePage = await resolvePageLocation({
    pageUrl: "https://where2walk.co.uk/walk/discover-walk-skipton-moor/",
  });
  const calfLivePage = await resolvePageLocation({
    pageUrl: "https://where2walk.co.uk/walk/calf-top-barbondale-walk/",
  });
  if (!skiLivePage || skiLivePage.coordSource === "title-geocode") {
    throw new Error(
      `Live Skipton Moor used ${skiLivePage?.coordSource ?? "nothing"} — expected page data`,
    );
  }
  if (!calfLivePage || calfLivePage.coordSource === "title-geocode") {
    throw new Error(
      `Live Calf Top used ${calfLivePage?.coordSource ?? "nothing"} — expected page data`,
    );
  }
  if (haversineKm(skiLivePage, skiFromPage) > 0.3) {
    throw new Error("Live Skipton Moor page pin drifted from the extracted start snippet");
  }
  if (haversineKm(calfLivePage, calfFromPage) > 0.3) {
    throw new Error("Live Calf Top page pin drifted from the extracted start snippet");
  }
  console.log(
    `live source pages ok: Skipton ${skiLivePage.coordSource}; Calf ${calfLivePage.coordSource}`,
  );

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

  const skiStored = store.activities.find((a) => /skipton moor/i.test(a.title));
  const calfStored = store.activities.find((a) =>
    /calf top and barbondale/i.test(a.title),
  );
  if (!skiStored || !calfStored) {
    throw new Error("Store missing Skipton Moor or Calf Top / Barbondale");
  }

  const skiSource = skiStored.rawFacts.coordSource;
  const calfSource = calfStored.rawFacts.coordSource;
  if (!skiSource || skiSource === "title-geocode") {
    throw new Error(`Skipton Moor store still title-geocoded (${skiSource})`);
  }
  if (!calfSource || calfSource === "title-geocode") {
    throw new Error(`Calf Top store still title-geocoded (${calfSource})`);
  }
  if (haversineKm(skiStored.coordinates, skiLivePage) > 0.5) {
    throw new Error(
      `Skipton Moor store pin is ${haversineKm(skiStored.coordinates, skiLivePage).toFixed(1)}km from the source-page start`,
    );
  }
  if (haversineKm(calfStored.coordinates, calfLivePage) > 0.5) {
    throw new Error(
      `Calf Top store pin is ${haversineKm(calfStored.coordinates, calfLivePage).toFixed(1)}km from the source-page start`,
    );
  }
  if (haversineKm(store.origin, skiLivePage) < 20) {
    throw new Error("Skipton Moor page start is implausibly close to YO7 4SQ (local homonym)");
  }
  if (haversineKm(store.origin, calfLivePage) < 40) {
    throw new Error("Calf Top page start is implausibly close to YO7 4SQ (local homonym)");
  }

  const osrm = await getDriveTimesMinutes(store.origin, [
    { id: "ski", location: skiLivePage },
    { id: "calf", location: calfLivePage },
  ]);
  if (osrm.ski == null || osrm.calf == null) {
    throw new Error("OSRM returned no drive times for the two walks");
  }
  if (Math.abs((skiStored.driveMinutes ?? 0) - osrm.ski) > 5) {
    throw new Error(
      `Skipton Moor badge ${skiStored.driveMinutes} min != OSRM ${osrm.ski} min`,
    );
  }
  if (Math.abs((calfStored.driveMinutes ?? 0) - osrm.calf) > 5) {
    throw new Error(
      `Calf Top badge ${calfStored.driveMinutes} min != OSRM ${osrm.calf} min`,
    );
  }
  console.log(
    `drive pins ok: Skipton Moor ${skiStored.driveMinutes} min (OSRM ${osrm.ski}, ${skiSource}); Calf Top ${calfStored.driveMinutes} min (OSRM ${osrm.calf}, ${calfSource})`,
  );

  console.log("verify passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
