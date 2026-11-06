// The ⌘K command palette (owner, 6 Nov 2026), on the visual tests' invented backend (shell-env.mjs, staging's flags):
//   node e2e/visual/palette-walk.mjs [--no-build] [--out DIR]
// Checks: Ctrl+K opens it with "Go to"; "settings" + Enter opens Settings; a lead's name finds the lead (C1's search) and opens its page; "Ask the assistant: <text>" opens Talk to assistant with the question
// asked; Telugu typing finds the Telugu word; on a phone the top bar's search opens it full screen. Pictures to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-shell/palette). Exit code 1 when a check fails.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { PACKS, STAGING_FLAGS, TENANT, WEB_DIR, WEB_URL, sessionCookieValue, startApp, usePack } from "./shell-env.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-shell/palette"));
const BASE = `/app/tenants/${TENANT}`;
const DICT = JSON.parse(readFileSync(path.join(WEB_DIR, "i18n", "strings", "app.json"), "utf8"));
const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function page(browser, cookie, viewport, lang = "en") {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true, colorScheme: "light", timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: "light", url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
  const p = await ctx.newPage();
  await p.goto(`${WEB_URL}${BASE}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await p.waitForSelector('[data-top="search"]', { state: "attached", timeout: 30_000 });
  return { ctx, p };
}
const openWithKeys = async (p) => {
  await p.keyboard.press("Control+k");
  await p.waitForSelector("[data-palette] [role=combobox]", { timeout: 15_000 });
};

const { close } = await startApp({ build: !process.argv.includes("--no-build"), log: "palette-walk", env: STAGING_FLAGS });
try {
  mkdirSync(OUT, { recursive: true });
  usePack(PACKS[0]);
  const browser = await chromium.launch();
  const cookie = sessionCookieValue();
  const { ctx, p } = await page(browser, cookie, { width: 1440, height: 900 });
  // 1. Ctrl+K: the empty palette has Go to
  await openWithKeys(p);
  check(await p.getByText("Go to", { exact: true }).isVisible(), "Ctrl+K opens the palette with Go to");
  await p.screenshot({ path: path.join(OUT, "desktop-empty.png") });
  // 2. "settings" + Enter: Settings
  await p.keyboard.type("settings");
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, "desktop-settings.png") });
  await p.keyboard.press("Enter");
  await p.waitForURL((u) => u.pathname === `${BASE}/settings`, { timeout: 20_000 }).catch(() => null);
  check(new URL(p.url()).pathname === `${BASE}/settings`, `"settings" + Enter opens Settings (at ${new URL(p.url()).pathname})`);
  // 3. a lead's name: the record, then its page
  await p.click('[data-top="search"]');
  await p.waitForSelector("[data-palette] [role=combobox]");
  await p.keyboard.type("anjali");
  const rec = p.locator('[data-palette-item^="record:lead:"]');
  await rec.first().waitFor({ timeout: 10_000 }).catch(() => null);
  check((await rec.count()) === 1, "a lead's name finds the lead (Records)");
  await p.screenshot({ path: path.join(OUT, "desktop-record.png") });
  if (await rec.count()) {
    await rec.first().click();
    await p.waitForURL((u) => u.pathname.startsWith(`${BASE}/leads/`), { timeout: 20_000 }).catch(() => null);
  }
  check(new URL(p.url()).pathname === `${BASE}/leads/55555555-5555-4555-8555-555555555555`, `the lead opens its page (at ${new URL(p.url()).pathname})`);
  // 4. Ask the assistant: the only item that goes to the assistant, always last
  await openWithKeys(p);
  await p.keyboard.type("what needs me today");
  const items = await p.locator("[data-palette-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-palette-item")));
  check(items[items.length - 1] === "ask", `"Ask the assistant" is the last item (${items.join(", ")})`);
  await p.screenshot({ path: path.join(OUT, "desktop-ask.png") });
  await p.click('[data-palette-item="ask"]');
  await p.waitForURL((u) => u.pathname === `${BASE}/talk`, { timeout: 20_000 }).catch(() => null);
  await p.waitForTimeout(1500);
  const talkText = await p.evaluate(() => document.querySelector("#main-content")?.textContent ?? "");
  check(new URL(p.url()).pathname === `${BASE}/talk` && talkText.includes("what needs me today"), "Ask opens Talk to assistant with the question asked");
  await p.screenshot({ path: path.join(OUT, "desktop-talk-asked.png") });
  await ctx.close();
  // 5. Telugu: the Telugu word for Settings finds it
  const te = await page(browser, cookie, { width: 1440, height: 900 }, "te");
  await openWithKeys(te.p);
  const word = DICT["nav.item.settings"].te;
  await te.p.keyboard.type(word);
  await te.p.waitForTimeout(300);
  check((await te.p.locator('[data-palette-item="settings"]').count()) === 1, `Telugu "${word}" finds Settings`);
  await te.p.screenshot({ path: path.join(OUT, "desktop-te.png") });
  await te.ctx.close();
  // 6. a phone: the top bar's search opens it full screen
  const ph = await page(browser, cookie, { width: 390, height: 844 });
  await ph.p.click('[data-top="search-phone"]');
  await ph.p.waitForSelector("[data-palette] [role=combobox]");
  const full = await ph.p.evaluate(() => {
    const d = document.querySelector("[data-palette] [role=dialog]")?.getBoundingClientRect();
    return d ? d.width >= window.innerWidth - 1 && d.height >= window.innerHeight - 1 : false;
  });
  check(full, "on a phone it fills the screen");
  await ph.p.screenshot({ path: path.join(OUT, "phone-empty.png") });
  await ph.ctx.close();
  await browser.close();
  console.log(`palette-walk: pictures in ${OUT}`);
} finally {
  await close();
}
if (fails.length) process.exitCode = 1;
