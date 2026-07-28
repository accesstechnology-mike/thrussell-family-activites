import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const TARGETS = [
  {
    key: "muddy-boots-mummy-yorkshire-walks",
    url: "https://muddybootsmummy.co.uk/family-friendly-walks-in-yorkshire/",
  },
  {
    key: "little-vikings-family-walks",
    url: "https://little-vikings.co.uk/best-family-walks-york-yorkshire-kids/",
  },
  {
    key: "alltrails-north-yorkshire-kids",
    url: "https://www.alltrails.com/en-gb/england/north-yorkshire/kids",
  },
] as const;

async function main() {
  mkdirSync("data/source-cache", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  for (const target of TARGETS) {
    try {
      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(5000);
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText || "");
      const html = await page.content();
      const blocked =
        /just a moment|bot verification/i.test(title) || text.length < 800;
      if (blocked) {
        console.log(`BLOCKED ${target.key} title=${title} text=${text.length}`);
        continue;
      }
      writeFileSync(`data/source-cache/${target.key}.html`, html);
      writeFileSync(
        `data/source-cache/${target.key}.meta.json`,
        `${JSON.stringify(
          { url: target.url, fetchedAt: new Date().toISOString() },
          null,
          2,
        )}\n`,
      );
      console.log(`SAVED ${target.key} text=${text.length}`);
    } catch (err) {
      console.log(
        `ERROR ${target.key}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
