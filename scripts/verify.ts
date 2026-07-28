import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000";

  const storePath = path.join(process.cwd(), "data/activities.json");
  const storeRaw = await readFile(storePath, "utf8");
  const store = JSON.parse(storeRaw) as {
    activities: unknown[];
    syncedAt: string | null;
  };
  if (!store.activities?.length) {
    throw new Error("Local store is empty — run npm run sync first");
  }
  console.log(`store ok: ${store.activities.length} activities`);

  const listRes = await fetch(`${base}/api/activities`);
  if (!listRes.ok) throw new Error(`/api/activities ${listRes.status}`);
  const list = (await listRes.json()) as {
    count: number;
    activities: Array<{ id: string; imageUrl: string | null }>;
  };
  if (!list.count) throw new Error("API returned zero activities");
  console.log(`api list ok: ${list.count}`);

  const id = list.activities[0]!.id;
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
