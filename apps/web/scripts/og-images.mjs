// npm run og:images (job BS): draws the share pictures (1200 x 630, Open Graph and Twitter) with a real browser: the owl, the headline of the landing page in each language and the product name.
//   public/og/og-en.png, og-te.png, og-hi.png, og-kn.png
// The words are the landing page's own (i18n/strings/landing.json: hero.h1), so a picture never says what the page does not. The generated files are committed; run this when the headline, the owl or
// the brand colour changes. A test (lib/seo/seo.test.ts) checks the four exist at 1200 x 630.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const require = createRequire(path.resolve(web, "../../e2e/package.json"));
const { chromium } = require("playwright");

const landing = JSON.parse(readFileSync(path.join(web, "i18n/strings/landing.json"), "utf8"));
const brand = /BRAND_NAME = "([^"]+)"/.exec(readFileSync(path.join(web, "design/brand.ts"), "utf8"))[1].split(" ")[0];
const owl = readFileSync(path.join(web, "scripts/assets/owl.svg"), "utf8").replace(' width="240" height="250"', ' width="100%" height="100%"');
const out = path.join(web, "public/og");
mkdirSync(out, { recursive: true });

const fonts = { en: "system-ui, sans-serif", te: "'Noto Sans Telugu', 'Telugu MN', system-ui, sans-serif", hi: "'Noto Sans Devanagari', 'Devanagari Sangam MN', system-ui, sans-serif", kn: "'Noto Sans Kannada', 'Kannada Sangam MN', system-ui, sans-serif" };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const lang of ["en", "te", "hi", "kn"]) {
  const h1 = landing["hero.h1"][lang].replaceAll("⁠", "");
  const eyebrow = landing["hero.eyebrow"][lang].replaceAll("⁠", "");
  await page.setContent(`<!doctype html><html lang="${lang}"><body style="margin:0;width:1200px;height:630px;background:#f9f8f6;font-family:${fonts[lang]};color:#1e1e24;display:grid;grid-template-columns:420px 1fr;align-items:center;position:relative;overflow:hidden">
<div style="position:absolute;left:0;top:0;bottom:0;width:420px;background:#ff773c"></div>
<div style="position:relative;display:grid;place-items:center;height:630px"><div style="width:300px;height:312px">${owl}</div></div>
<div style="padding:0 64px 0 56px">
<p style="margin:0 0 18px;font-size:28px;font-weight:600;color:#c2410c">${eyebrow}</p>
<h1 style="margin:0;font-size:${lang === "en" ? 58 : 50}px;line-height:1.22;font-weight:800;letter-spacing:-0.5px">${h1}</h1>
<p style="margin:32px 0 0;font-size:34px;font-weight:700;color:#1e1e24"><span style="color:#ff773c">●</span> ${brand}</p>
</div></body></html>`);
  await page.screenshot({ path: path.join(out, `og-${lang}.png`) });
  console.log(`og-${lang}.png`);
}
await browser.close();
