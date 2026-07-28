import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { enrichActivityImages } from "../src/lib/images";
import type { Activity, ActivityStore } from "../src/lib/types";

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;

  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg?.slice("--only=".length);

  let targets: Activity[] = store.activities;
  if (only) {
    targets = store.activities.filter((a) => a.id.includes(only));
    if (!targets.length) throw new Error(`No activities matching ${only}`);
  } else {
    targets = store.activities.filter(
      (a) =>
        !a.imageUrl ||
        !a.imageUrl.startsWith("/media/") ||
        Boolean(a.rawFacts?.imageRemote && !a.imageUrl?.startsWith("/media/")),
    );
  }

  console.log(`Enriching images for ${targets.length} activities…`);
  const updated = await enrichActivityImages(targets);
  const byId = new Map(updated.map((a) => [a.id, a]));
  store.activities = store.activities.map((a) => byId.get(a.id) ?? a);
  store.syncedAt = new Date().toISOString();

  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  for (const a of updated) {
    console.log(`${a.id}: ${a.imageUrl ?? "(none)"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
