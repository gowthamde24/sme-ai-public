// npm run pwa:icons (job BL): draws the AI-circle icon set (job DM) from public/icons/orb.svg with a real browser (Chromium, the one the e2e run installs: e2e/node_modules/playwright).
//   icon-<size>.png            "any" icons, the circle on a transparent square (48 to 512)
//   maskable-192/512.png        the circle in the middle 62% on the brand colour, full bleed, so any mask shape keeps the whole circle
//   apple-touch-icon.png        180 px, opaque (iOS draws its own corners)
// The generated files are committed; run this only when the circle or the brand colour changes. A test (lib/pwa/pwa.test.ts) checks the set exists and the svg is a plain file.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const require = createRequire(path.resolve(web, "../../e2e/package.json"));
const { chromium } = require("playwright");

const BRAND = "#ff773c"; // --v2-brand (design/tokens.css)
const svg = readFileSync(path.join(web, "public/icons/orb.svg"), "utf8").replace(' width="96" height="96"', ' width="100%" height="100%"');
const out = path.join(web, "public/icons");
mkdirSync(out, { recursive: true });

const jobs = [
  ...[48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512].map((s) => ({ file: `icon-${s}.png`, size: s, bg: null, fill: 0.9 })),
  ...[192, 512].map((s) => ({ file: `maskable-${s}.png`, size: s, bg: BRAND, fill: 0.62 })),
  { file: "apple-touch-icon.png", size: 180, bg: BRAND, fill: 0.72 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  const h = Math.round(j.size * j.fill);
  const w = h;
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${j.size}px;height:${j.size}px;background:${j.bg ?? "transparent"};display:grid;place-items:center"><div style="width:${w}px;height:${h}px">${svg}</div></body></html>`);
  await page.screenshot({ path: path.join(out, j.file), omitBackground: j.bg === null });
  console.log(j.file);
}
await browser.close();
