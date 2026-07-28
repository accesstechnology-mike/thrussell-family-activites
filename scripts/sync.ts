import { syncAllSources } from "../src/lib/sources/sync";
import { summariseStatuses } from "../src/lib/store";

async function main() {
  console.log("Syncing family activities near YO7 4SQ…");
  const result = await syncAllSources();
  console.log(`Saved ${result.store.activities.length} activities`);
  console.log(summariseStatuses(result.statuses));
  console.log(`Store written. syncedAt=${result.store.syncedAt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
