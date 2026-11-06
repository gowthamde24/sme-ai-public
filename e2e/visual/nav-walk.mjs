// Every menu item opens its OWN page (owner rule, 6 Nov 2026: standard navigation), for the three business types the owner named, on the visual tests' invented backend (shell-env.mjs).
//
//   node e2e/visual/nav-walk.mjs [--no-build] [--out DIR] [--no-shots]
//
// For sarees, cements and school, at 1440 x 900 in English, it reads every row of the side menu and opens each one by clicking it, then checks:
//   - the address is the row's own (no redirect to another page, and no two rows share one);
//   - the page's H1 is the row's word, exactly as the menu shows it;
//   - that row, and only it, is marked current;
//   - the page never says "Not available yet";
//   - the group headings only fold and unfold (buttons, not links);
//   - on a phone (390), the bottom bar's items and the More sheet's rows go to the same addresses as the side menu's.
// One picture per page goes to DIR/<pack>-<row>.png (default /Volumes/Stack19/stack19/v2-overnight/shots-shell/pages). Exit code 1 when any check fails.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { PACKS, STAGING_FLAGS, TENANT, WEB_DIR, WEB_URL, sessionCookieValue, startApp, usePack } from "./shell-env.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-shell/pages"));
const SHOTS = !process.argv.includes("--no-shots");
const BASE = `/app/tenants/${TENANT}`;
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

async function context(browser, cookie, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true, colorScheme: "light", timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sme_theme", value: "light", url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
  return ctx;
}

const menuRows = (page, scope) =>
  page.evaluate((sel) => [...document.querySelectorAll(`${sel} a[data-nav-row]`)].map((a) => ({ id: a.getAttribute("data-nav-row"), href: new URL(a.href).pathname + new URL(a.href).search + new URL(a.href).hash, label: (a.querySelector("[data-nav-label]") ?? a).textContent })), scope);

async function walkPack(browser, cookie, pack) {
  usePack(pack);
  const fails = [];
  const fail = (what) => fails.push(`${pack.short}: ${what}`);
  const ctx = await context(browser, cookie, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${WEB_URL}${BASE}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-nav-scroll] a[data-nav-row]", { timeout: 30_000 });
  // the menu settles once the business type and the counts have arrived (a row the business type does not have leaves then)
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(1000);
  const rows = (await menuRows(page, "[data-nav-scroll]")).map((r) => ({ ...r, label: norm(r.label) }));
  // the group headings only fold and unfold
  const headingLinks = await page.evaluate(() => [...document.querySelectorAll("[data-nav-scroll] [aria-expanded]")].filter((e) => e.tagName === "A").length);
  if (headingLinks) fail(`${headingLinks} group heading(s) are links`);
  const seen = new Map();
  for (const row of rows) {
    if (row.href.includes("#") || row.href.includes("?")) fail(`${row.id} "${row.label}" goes to ${row.href} (an anchor or a tab of another page, not a page of its own)`);
    const pathOnly = row.href.split(/[?#]/)[0];
    if (seen.has(pathOnly)) fail(`${row.id} and ${seen.get(pathOnly)} share ${pathOnly}`);
    seen.set(pathOnly, row.id);
    // open it as a person does: a click on the row (Back, refresh and bookmarks are the address's)
    await page.goto(`${WEB_URL}${BASE}`, { waitUntil: "domcontentloaded" });
    // the menu is drawn again once the counts arrive: a row that moved under the pointer is pressed again
    for (let tries = 0; ; tries++) {
      try {
        await page.locator(`[data-nav-scroll] a[data-nav-row="${row.id}"]`).click({ timeout: 10_000 });
        break;
      } catch (e) {
        if (tries >= 2) throw e;
        await page.waitForTimeout(500);
      }
    }
    await page.waitForURL((u) => u.pathname === pathOnly, { timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(400);
    const now = new URL(page.url());
    if (now.pathname !== pathOnly) fail(`${row.id} "${row.label}": clicked ${row.href}, landed on ${now.pathname}${now.search}`);
    const h1 = norm(await page.locator("main h1, [id=main-content] h1").first().textContent({ timeout: 5_000 }).catch(() => null));
    if (h1 !== row.label) fail(`${row.id}: H1 is "${h1}", the menu says "${row.label}"`);
    const current = await page.evaluate(() => [...document.querySelectorAll('[data-nav-scroll] a[data-nav-row][aria-current="page"]')].map((a) => a.getAttribute("data-nav-row")));
    if (current.length !== 1 || current[0] !== row.id) fail(`${row.id}: marked current is [${current.join(", ")}]`);
    const text = await page.evaluate(() => document.querySelector("#main-content")?.textContent ?? "");
    // the placeholder of a part that could not be read (frame.notyet), not a sentence that says a figure is not known yet
    if (/(^|[^a-z])Not available yet/.test(text)) fail(`${row.id}: the page says "Not available yet"`);
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `${pack.short}-${row.id.replace(/^m-/, "")}.png`) });
    console.log(`  ${pack.short} ${row.id.padEnd(14)} ${row.href.padEnd(34)} h1="${h1}"`);
  }
  await ctx.close();
  // the phone: the bottom bar and the More sheet go to the same addresses
  const phone = await context(browser, cookie, { width: 390, height: 844 });
  const pp = await phone.newPage();
  await pp.goto(`${WEB_URL}${BASE}`, { waitUntil: "domcontentloaded" });
  await pp.waitForSelector("[data-bar-tab]", { timeout: 30_000 });
  const byId = new Map(rows.map((r) => [r.id, r.href]));
  const bar = await pp.evaluate(() => [...document.querySelectorAll("a[data-bar-tab]")].map((a) => ({ id: a.getAttribute("data-bar-tab"), href: new URL(a.href).pathname + new URL(a.href).search + new URL(a.href).hash })));
  await pp.click('[data-bar-tab="more"]');
  await pp.waitForSelector("[data-more-sheet]");
  const more = await menuRows(pp, "[data-more-sheet]");
  for (const r of [...bar, ...more]) if (byId.has(r.id) && byId.get(r.id) !== r.href) fail(`phone ${r.id} goes to ${r.href}, the side menu to ${byId.get(r.id)}`);
  await phone.close();
  return { rows, fails };
}

const { standIn, close } = await startApp({ build: !process.argv.includes("--no-build"), log: "nav-walk", env: STAGING_FLAGS });
let failed = false;
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const cookie = sessionCookieValue();
  for (const pack of PACKS) {
    console.log(`nav-walk: ${pack.short}`);
    const { rows, fails } = await walkPack(browser, cookie, pack);
    for (const f of fails) console.log(`FAIL ${f}`);
    console.log(`nav-walk: ${pack.short}: ${rows.length} items, ${fails.length ? `${fails.length} failing` : "all pass"}`);
    if (fails.length) failed = true;
  }
  await browser.close();
  if (standIn.misses.size) console.log(`nav-walk: the stand-in had no fixture for:\n  ${[...standIn.misses].join("\n  ")}`);
} finally {
  await close();
}
if (failed) process.exitCode = 1;
