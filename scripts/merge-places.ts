/**
 * Collapse cross-source (and within-source) listings of the same place,
 * inherit sibling photos, then backfill remaining gaps via the image pipeline.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeDuplicateActivities } from "../src/lib/dedupe";
import { enrichActivityImages } from "../src/lib/images";
import type { ActivityStore } from "../src/lib/types";

function missingImageCount(store: ActivityStore): number {
  return store.activities.filter((a) => !a.imageUrl).length;
}

function missingBySource(store: ActivityStore): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of store.activities) {
    if (a.imageUrl) continue;
    counts[a.source] = (counts[a.source] || 0) + 1;
  }
  return counts;
}

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;

  const beforeCards = store.activities.length;
  const beforeMissing = missingImageCount(store);
  const beforeMissingBySource = missingBySource(store);

  console.log(
    JSON.stringify(
      {
        before: {
          cards: beforeCards,
          missingImages: beforeMissing,
          missingBySource: beforeMissingBySource,
          originPostcode: store.originPostcode,
        },
      },
      null,
      2,
    ),
  );

  const { activities: merged, stats } = mergeDuplicateActivities(
    store.activities,
  );
  store.activities = merged;
  const afterMergeMissing = missingImageCount(store);

  const needImages = store.activities.filter(
    (a) => !a.imageUrl || !a.imageUrl.startsWith("/media/"),
  );
  console.log(
    `Merged ${stats.before} → ${stats.after} cards (${stats.clusters} clusters). Enriching ${needImages.length} missing/remote images…`,
  );

  const imaged = await enrichActivityImages(needImages);
  const byId = new Map(imaged.map((a) => [a.id, a]));
  store.activities = store.activities.map((a) => byId.get(a.id) ?? a);
  store.syncedAt = new Date().toISOString();

  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        after: {
          cards: store.activities.length,
          missingImages: missingImageCount(store),
          missingBySource: missingBySource(store),
          originPostcode: store.originPostcode,
          clusters: stats.clusters,
          listingsMerged: stats.listingsMerged,
          inheritedOrFilled:
            afterMergeMissing - missingImageCount(store) +
            (beforeMissing - afterMergeMissing),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
