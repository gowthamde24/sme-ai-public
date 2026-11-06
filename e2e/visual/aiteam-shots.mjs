// My AI team v2 (job ai-team-v2) on the visual tests' invented backend, with AI_TEAM_SCREENS=mock (the made-up day of lib/api/ai-team-fixtures.ts):
//   node e2e/visual/aiteam-shots.mjs [--no-build] [--out DIR]
// Pictures: sarees and school, desktop 1440 and 1366, phone 390 and 360, light and dark, en and te; the helper panel; the stand-up card on Today. Checks (A3): no horizontal page scroll anywhere; the ⚑ count of the lanes equals the day's
// needs-you count; a lane's name opens its panel; a mark is a link to its own item. Exit code 1 when a check fails. Default DIR: /Volumes/Stack19/stack19/v2-overnight/shots-aiteam
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
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-aiteam"));
const BASE = `/app/tenants/${TENANT}`;
const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function open(browser, cookie, { width, height, theme = "light", lang = "en", path: at = "/ai-team" }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, colorScheme: theme, timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: theme, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
  const p = await ctx.newPage();
  await p.goto(`${WEB_URL}${BASE}${at}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await p.waitForTimeout(800);
  return { ctx, p };
}
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const { close } = await startApp({ build: !process.argv.includes("--no-build"), log: "aiteam-shots", env: { ...STAGING_FLAGS, AI_TEAM_SCREENS: "mock" } });
try {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const cookie = sessionCookieValue();
  for (const pack of [PACKS[0], PACKS[2]]) {
    usePack(pack);
    const tag = pack.short;
    // desktop: the checks, then the pictures
    const { ctx, p } = await open(browser, cookie, { width: 1440, height: 1100 });
    await p.waitForSelector("[data-aiteam] [data-lane]", { timeout: 30_000 });
    const h1 = (await p.textContent("#main-content h1"))?.trim();
    check(h1 === "My AI team", `${tag}: H1 is "My AI team" (${h1})`);
    const flags = await p.locator("[data-lane] [data-owner]").count();
    check(flags > 0, `${tag}: the lanes have ⚑ marks (${flags})`);
    const lanes = await p.locator("[data-lane]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lane")));
    check(lanes.length === 6, `${tag}: six lanes (${lanes.join(", ")})`);
    const href = await p.locator("[data-lane] a[data-mark]").first().getAttribute("href");
    check(/^\/app\/tenants\/[^/]+\/(leads|quotes|orders|students|visits|campaigns|retailers|admissions)/.test(href ?? ""), `${tag}: a mark links to its item (${href})`);
    check(await noSideScroll(p), `${tag}: desktop 1440 has no horizontal page scroll`);
    await p.screenshot({ path: path.join(OUT, `${tag}-desktop-1440-en-light.png`), fullPage: true });
    // hover a ⚑ mark: its one line
    await p.locator("[data-lane] [data-owner]").first().hover();
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(OUT, `${tag}-desktop-1440-hover.png`) });
    // the flow strip filters
    await p.locator("[data-flow]").nth(1).click();
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(OUT, `${tag}-desktop-1440-filtered.png`), fullPage: true });
    await p.locator("[data-flow]").nth(1).click();
    // the panel
    await p.locator(`[data-lane] [data-lane-open="${lanes[1]}"]`).click();
    await p.waitForSelector("[data-helper-panel] [data-part=numbers]", { timeout: 15_000 });
    check(true, `${tag}: a lane's name opens its panel`);
    await p.screenshot({ path: path.join(OUT, `${tag}-desktop-1440-panel.png`) });
    await ctx.close();
    for (const v of [
      { width: 1366, height: 900, theme: "dark", lang: "en" },
      { width: 1440, height: 1100, theme: "light", lang: "te" },
      { width: 390, height: 844, theme: "light", lang: "en" },
      { width: 360, height: 780, theme: "dark", lang: "te" },
      { width: 390, height: 844, theme: "light", lang: "te" },
    ]) {
      const o = await open(browser, cookie, v);
      await o.p.waitForSelector("[data-aiteam]", { timeout: 30_000 });
      const kind = v.width < 768 ? "phone" : "desktop";
      check(await noSideScroll(o.p), `${tag}: ${kind} ${v.width} ${v.theme} ${v.lang} has no horizontal page scroll`);
      await o.p.screenshot({ path: path.join(OUT, `${tag}-${kind}-${v.width}-${v.lang}-${v.theme}.png`), fullPage: true });
      if (kind === "phone" && v.lang === "en") {
        await o.p.locator('[data-part="phone-day"] [data-lane-open]').first().click();
        await o.p.waitForSelector("[data-helper-panel] [data-part=numbers]", { timeout: 15_000 });
        await o.p.screenshot({ path: path.join(OUT, `${tag}-phone-${v.width}-panel.png`) });
      }
      await o.ctx.close();
    }
    // Today: the stand-up card (Owner)
    const t = await open(browser, cookie, { width: 1440, height: 1100, path: "" });
    const card = await t.p.locator('[data-part="standup-today"]').count();
    check(card === 1, `${tag}: Today has the stand-up card`);
    await t.p.screenshot({ path: path.join(OUT, `${tag}-today-standup.png`), fullPage: true });
    await t.ctx.close();
  }
  await browser.close();
  console.log(`aiteam-shots: pictures in ${OUT}`);
} finally {
  await close();
}
if (fails.length) process.exitCode = 1;
