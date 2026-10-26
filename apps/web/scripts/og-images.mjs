// npm run og:images (job BS, extended by job CM): draws the share pictures (1200 x 630, Open Graph and Twitter) with a real browser: the AI circle, the headline and the product name.
//   public/og/og-<lang>.png            (4)  the home page and the fixed pages
//   public/og/og-<slug>-<lang>.png     (12) one business type's page, in that type's colour
// The words are the pages' own (i18n/strings/site.json hero.h1 / hero.eyebrow, and each business type's landing hero in lib/site/site-packs.generated.json, which `make site-packs` builds), so a picture never says what the page
// does not. The generated files are committed; run this when a headline, the circle or a colour changes. A test (lib/seo/seo.test.ts) checks every file exists at 1200 x 630.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const require = createRequire(path.resolve(web, "../../e2e/package.json"));
const { chromium } = require("playwright");

const site = JSON.parse(readFileSync(path.join(web, "i18n/strings/site.json"), "utf8"));
const packs = JSON.parse(readFileSync(path.join(web, "lib/site/site-packs.generated.json"), "utf8")).packs;
const brand = /BRAND_NAME = "([^"]+)"/.exec(readFileSync(path.join(web, "design/brand.ts"), "utf8"))[1].split(" ")[0];
const assistant = /DEFAULT_ASSISTANT_NAME = "([^"]+)"/.exec(readFileSync(path.join(web, "lib/assistant/name.ts"), "utf8"))[1]; // {assistant} in a headline is the default name here (the public site never has a workspace's own)
const orb = `data:image/svg+xml;base64,${readFileSync(path.join(web, "public/icons/orb.svg")).toString("base64")}`;
const out = path.join(web, "public/og");
mkdirSync(out, { recursive: true });

// the accent tokens of design/tokens.css (--v2-pack-*-edge / -text), light theme
const ACCENT = { rose_silk: { edge: "#be3455", text: "#9f1d3d" }, terracotta: { edge: "#b4532a", text: "#8f3c14" }, sky_blue: { edge: "#2f7db5", text: "#14527f" } };
const HOME = { edge: "#ff773c", text: "#c2410c" };
const clean = (s) => s.replaceAll("{assistant}", assistant).replaceAll("⁠", "").replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const fonts = { en: "system-ui, sans-serif", te: "'Noto Sans Telugu', 'Telugu MN', system-ui, sans-serif", hi: "'Noto Sans Devanagari', 'Devanagari Sangam MN', system-ui, sans-serif", kn: "'Noto Sans Kannada', 'Kannada Sangam MN', system-ui, sans-serif" };

const jobs = [];
for (const lang of ["en", "te", "hi", "kn"]) {
  jobs.push({ file: `og-${lang}.png`, lang, eyebrow: site["hero.eyebrow"][lang], h1: site["hero.h1"][lang], colour: HOME });
  for (const p of packs) jobs.push({ file: `og-${p.slug}-${lang}.png`, lang, eyebrow: p.hero.eyebrow[lang] ?? p.hero.eyebrow.en, h1: p.hero.h1[lang] ?? p.hero.h1.en, colour: ACCENT[p.accent] ?? HOME });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const { file, lang, eyebrow, h1, colour } of jobs) {
  const size = h1.length > 60 ? (lang === "en" ? 50 : 44) : lang === "en" ? 58 : 50;
  await page.setContent(`<!doctype html><html lang="${lang}"><body style="margin:0;width:1200px;height:630px;background:#f9f8f6;font-family:${fonts[lang]};color:#1e1e24;display:grid;grid-template-columns:420px 1fr;align-items:center;position:relative;overflow:hidden">
<div style="position:absolute;left:0;top:0;bottom:0;width:420px;background:${colour.edge}"></div>
<div style="position:relative;display:grid;place-items:center;height:630px"><img src="${orb}" width="300" height="300" alt="" style="display:block;filter:drop-shadow(0 20px 40px rgba(0,0,0,.25))"></div>
<div style="padding:0 64px 0 56px">
<p style="margin:0 0 18px;font-size:28px;font-weight:600;color:${colour.text}">${clean(eyebrow)}</p>
<h1 style="margin:0;font-size:${size}px;line-height:1.22;font-weight:800;letter-spacing:-0.5px">${clean(h1)}</h1>
<p style="margin:32px 0 0;font-size:34px;font-weight:700;color:#1e1e24"><span style="color:${colour.edge}">●</span> ${brand}</p>
</div></body></html>`);
  await page.screenshot({ path: path.join(out, file) });
  console.log(file);
}
await browser.close();
