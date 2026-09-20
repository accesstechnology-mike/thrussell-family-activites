import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  activitySourceList,
  mergeDuplicateActivities,
} from "../src/lib/dedupe";
import { getDriveTimesMinutes } from "../src/lib/drive-times";
import {
  cleanPlacePhrase,
  geocodePlaceName,
  geocodeQueryVariants,
  nominatimNameFitsQuery,
} from "../src/lib/geocode";
import { HOME_POSTCODE } from "../src/lib/config";
import {
  isJunkImageUrl,
  looksLikeGraphicNotice,
} from "../src/lib/images";
import { haversineKm } from "../src/lib/sources/listicle";
import {
  buildSuggestPool,
  interpretOutingRequest,
  rankSuggestions,
} from "../src/lib/suggest";
import type { Activity, ActivityStore } from "../src/lib/types";

function cardsMatching(activities: Activity[], re: RegExp): Activity[] {
  return activities.filter(
    (a) =>
      re.test(a.title) ||
      activitySourceList(a).some((s) => re.test(s.title)),
  );
}

function assertPlaceMerge(fixtures: Activity[], store: ActivityStore) {
  if (store.originPostcode !== HOME_POSTCODE) {
    throw new Error(`Home postcode must stay ${HOME_POSTCODE}`);
  }

  const { activities, stats } = mergeDuplicateActivities(fixtures);
  const brimham = cardsMatching(activities, /brimham/i);
  if (brimham.length !== 1) {
    throw new Error(`Expected 1 Brimham card from fixtures, got ${brimham.length}`);
  }
  if ((brimham[0]!.sources?.length ?? 0) < 4) {
    throw new Error(
      `Brimham should keep origin links, got ${brimham[0]!.sources?.length}`,
    );
  }

  const aysgarth = cardsMatching(activities, /aysgarth/i).filter((a) =>
    /fall/i.test(a.title + activitySourceList(a).map((s) => s.title).join(" ")),
  );
  if (aysgarth.length < 1) {
    throw new Error("Expected an Aysgarth Falls cluster");
  }

  const fountainsAbbey = cardsMatching(
    activities,
    /fountains abbey|studley royal/i,
  );
  const fountainsMain = fountainsAbbey.find(
    (a) => (a.sources?.length ?? 0) >= 4,
  );
  if (!fountainsMain) {
    throw new Error(
      `Expected a merged Fountains/Studley card, got ${fountainsAbbey.length} matches`,
    );
  }

  const fell = cardsMatching(activities, /fountains fell/i);
  if (fell.length !== 1) {
    throw new Error("Fountains Fell must stay a separate place");
  }

  const hardcastle = cardsMatching(activities, /hardcastle crags/i);
  if (hardcastle.length !== 1) {
    throw new Error(
      `Expected 1 Hardcastle Crags card, got ${hardcastle.length}`,
    );
  }
  const walkiees = activitySourceList(hardcastle[0]!).filter(
    (s) => s.source === "walkiees",
  );
  if (walkiees.length < 2) {
    throw new Error("Hardcastle should keep both Walkiees listings");
  }

  const seaLife = cardsMatching(activities, /sea life/i);
  const seaCut = cardsMatching(activities, /sea cut/i);
  if (!seaLife.length || !seaCut.length) {
    throw new Error("SEA LIFE and Sea Cut fixtures missing");
  }
  if (seaLife.some((a) => seaCut.some((b) => a.id === b.id))) {
    throw new Error("Scarborough SEA LIFE must not merge with Sea Cut");
  }

  const ribbleheadRoutes = cardsMatching(
    activities,
    /ribblehead to horton|dent station and ribblehead/i,
  );
  const ribbleheadShort = cardsMatching(activities, /ribblehead, a short walk|ribblehead viaduct/i);
  if (
    ribbleheadRoutes.length &&
    ribbleheadShort.length &&
    ribbleheadRoutes.some((a) => ribbleheadShort.some((b) => a.id === b.id))
  ) {
    throw new Error("Ribblehead mountain routes must not swallow the viaduct walk");
  }

  const kettlewellStep = cardsMatching(activities, /kettlewell stepping/i);
  const kettlewellStar = cardsMatching(activities, /starbotton/i);
  if (
    kettlewellStep.length &&
    kettlewellStar.length &&
    kettlewellStep.some((a) => kettlewellStar.some((b) => a.id === b.id))
  ) {
    throw new Error("Different Kettlewell walks must not merge");
  }

  if (stats.after >= stats.before) {
    throw new Error("Fixture merge should reduce card count");
  }

  const storeBrimham = cardsMatching(store.activities, /brimham/i);
  if (storeBrimham.length !== 1) {
    throw new Error(
      `Store should show one Brimham card, got ${storeBrimham.length}`,
    );
  }
  if ((storeBrimham[0]!.sources?.length ?? 0) < 4) {
    throw new Error("Store Brimham card missing origin sources[]");
  }
  if (storeBrimham[0]!.driveMinutes == null) {
    throw new Error("Canonical Brimham pin lost its YO7 4SQ drive time");
  }
  if (!storeBrimham[0]!.imageUrl) {
    throw new Error("Canonical Brimham card should inherit a sibling photo");
  }

  console.log(
    `place merge ok: fixtures ${stats.before}→${stats.after}; store ${store.activities.length} cards; Brimham sources=${storeBrimham[0]!.sources!.length}`,
  );
}

async function main() {
  const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000";

  const storePath = path.join(process.cwd(), "data/activities.json");
  const storeRaw = await readFile(storePath, "utf8");
  const store = JSON.parse(storeRaw) as ActivityStore;
  if (!store.activities?.length) {
    throw new Error("Local store is empty — run npm run sync first");
  }
  console.log(`store ok: ${store.activities.length} activities`);

  const fixturePath = path.join(process.cwd(), "src/lib/dedupe-fixtures.json");
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as Activity[];
  assertPlaceMerge(fixtures, store);

  if (
    !isJunkImageUrl(
      "https://falconrycentre.co.uk/wp-content/uploads/Website-advert-1-scaled.jpg",
    )
  ) {
    throw new Error("Venue adverts must be rejected as junk images");
  }
  if (
    !isJunkImageUrl(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Handicap_toilet_2.jpg",
    ) ||
    !isJunkImageUrl(
      "https://www.holmsidepark.co.uk/wp-content/uploads/2026/09/Pumpkin-Patch-Event.jpg",
    ) ||
    !isJunkImageUrl(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Pike_County_Pennsylvania_incorporated_and_unincorporated_areas_Pocono_Woodland_Lakes_highlighted.svg/map.png",
    )
  ) {
    throw new Error("Toilet, flyer, and locator-map images must be junk");
  }
  const noticeCard = store.activities.find((a) =>
    /thirsk birds of prey/i.test(a.title),
  );
  const poolCard = store.activities.find((a) =>
    /thirsk swimming pool/i.test(a.title),
  );
  if (!noticeCard || !poolCard) {
    throw new Error("Store missing Thirsk Birds of Prey or Swimming Pool");
  }
  const posterCard = path.join(
    process.cwd(),
    "public/media/8710e46b345bf0e4-card.webp",
  );
  try {
    const posterBuf = await readFile(posterCard);
    if (!(await looksLikeGraphicNotice(posterBuf))) {
      throw new Error(
        "Weather-warning poster should be detected as a graphic notice",
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (
    noticeCard.rawFacts.imageRemote &&
    (isJunkImageUrl(noticeCard.rawFacts.imageRemote) ||
      /IMG_3413/i.test(noticeCard.rawFacts.imageRemote))
  ) {
    throw new Error("Thirsk Birds of Prey still points at a junk remote image");
  }
  for (const card of [noticeCard, poolCard]) {
    if (!card.imageUrl?.startsWith("/media/")) continue;
    const buf = await readFile(
      path.join(process.cwd(), "public", card.imageUrl.replace(/^\//, "")),
    );
    if (await looksLikeGraphicNotice(buf)) {
      throw new Error(`${card.title} still has a graphic notice as its card photo`);
    }
  }
  console.log("image junk / notice filters ok");

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
  console.log("geocode variant / match rules ok");

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

  const skiLive = await geocodePlaceName("Walk on Skipton Moor, Yorkshire, UK");
  const calfLive = await geocodePlaceName("Calf Top and Barbondale, Yorkshire, UK");
  if (!skiLive || !calfLive) {
    throw new Error("Live Nominatim failed for Skipton Moor or Calf Top");
  }
  if (haversineKm(skiStored.coordinates, skiLive) > 3) {
    throw new Error(
      `Skipton Moor store pin is ${haversineKm(skiStored.coordinates, skiLive).toFixed(1)}km from live Nominatim`,
    );
  }
  if (haversineKm(calfStored.coordinates, calfLive) > 5) {
    throw new Error(
      `Calf Top store pin is ${haversineKm(calfStored.coordinates, calfLive).toFixed(1)}km from live Nominatim`,
    );
  }
  if (haversineKm(store.origin, skiLive) < 20) {
    throw new Error("Live Skipton Moor geocode is implausibly close to YO7 4SQ");
  }
  if (haversineKm(store.origin, calfLive) < 40) {
    throw new Error("Live Calf Top geocode is implausibly close to YO7 4SQ");
  }

  const osrm = await getDriveTimesMinutes(store.origin, [
    { id: "ski", location: skiLive },
    { id: "calf", location: calfLive },
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
    `drive pins ok: Skipton Moor ${skiStored.driveMinutes} min (OSRM ${osrm.ski}); Calf Top ${calfStored.driveMinutes} min (OSRM ${osrm.calf})`,
  );

  console.log("verify passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
