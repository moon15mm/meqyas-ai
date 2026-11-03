// Capture screenshots of the live site for the "live today" scene.
// Run from marketing/demo-video:  node scripts/capture_site.mjs
// Writes public/site/*.png and src/data/site.json (the scene shows a placeholder until then).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.env.SITE_URL ?? "https://meqyas.wardat.xyz/";
const PAGES = (process.env.SITE_PATHS ?? "/").split(",");

mkdirSync("public/site", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
const screens = [];
for (const [i, path] of PAGES.entries()) {
  await page.goto(new URL(path, URL).href, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const file = `site/page-${i + 1}.png`;
  await page.screenshot({ path: `public/${file}`, fullPage: true });
  screens.push(file);
  console.log("captured", path, "->", file);
}
await browser.close();
writeFileSync("src/data/site.json", JSON.stringify({ url: URL, screens }, null, 2) + "\n");
