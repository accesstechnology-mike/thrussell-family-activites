import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ActivityStore } from "../src/lib/types";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const MIN_CARD_BYTES = 2_000;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const storePath = path.join(process.cwd(), "data/activities.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as ActivityStore;

  const missingImage: string[] = [];
  const missingFile: string[] = [];
  const tinyFile: string[] = [];
  const remoteStill: string[] = [];
  const ok: string[] = [];

  for (const a of store.activities) {
    if (!a.imageUrl) {
      missingImage.push(a.id);
      continue;
    }
    if (!a.imageUrl.startsWith("/media/")) {
      remoteStill.push(`${a.id}\t${a.imageUrl}`);
      continue;
    }
    const file = path.join(MEDIA_DIR, path.basename(a.imageUrl));
    if (!(await exists(file))) {
      missingFile.push(`${a.id}\t${a.imageUrl}`);
      continue;
    }
    const size = (await stat(file)).size;
    if (size < MIN_CARD_BYTES) {
      tinyFile.push(`${a.id}\t${a.imageUrl}\t${size}`);
      continue;
    }
    ok.push(a.id);
  }

  console.log(
    JSON.stringify(
      {
        total: store.activities.length,
        ok: ok.length,
        missingImage: missingImage.length,
        missingFile: missingFile.length,
        tinyFile: tinyFile.length,
        remoteStill: remoteStill.length,
      },
      null,
      2,
    ),
  );

  if (missingFile.length) {
    console.log("\n# missing local files");
    for (const row of missingFile) console.log(row);
  }
  if (tinyFile.length) {
    console.log("\n# tiny local files");
    for (const row of tinyFile) console.log(row);
  }
  if (remoteStill.length) {
    console.log("\n# remote urls still stored");
    for (const row of remoteStill) console.log(row);
  }
  if (missingImage.length) {
    console.log("\n# no imageUrl");
    for (const id of missingImage) console.log(id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
