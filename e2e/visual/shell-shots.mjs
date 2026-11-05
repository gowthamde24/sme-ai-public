// Pictures of the app shell v2 (job sidebar v2, owner-approved design 5 Nov 2026) for the review before the owner: the grouped side menu with its counts and meters, the phone's bottom bar and its More sheet,
// on the visual tests' invented backend (stand-in.mjs: no database, no keys, no network after the build, no real person) with the three business types the owner named (sarees, building materials, a school).
//
//   node e2e/visual/shell-shots.mjs [--no-build] [--out DIR]
//
// Writes to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-shell):
//   desktop-<pack>-<light|dark>-<en|te>.png   Today at 1440 x 1000, the first screenful (sarees in Telugu too)
//   phone-<pack>-today-<en|te>.png, phone-<pack>-more-<en|te>.png   Today at 390 x 844, and with More open
// Same ports as run.mjs (54999, 3014); it stops only its own processes. It only looks: nothing is pressed but More.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, PACK_STATE, SESSION_USER, TENANT, USER_ID } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-shell"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// the three business types and an invented name for each (the stand-in's own business is "Sri Visual Silks")
const PACKS = [
  { id: "textiles", short: "sarees", name: "Lakshmi Silks (example)", finder: true },
  { id: "construction_materials", short: "cements", name: "Sri Sai Cements (example)", finder: true },
  { id: "education", short: "school", name: "Vidya Public School (example)", finder: false },
];
let current = PACKS[0];

const json = (body) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(typeof body === "function" ? body() : body));
};
const T = `/v1/tenants/${TENANT}`;
// the assistant is on (the stand-in's own list says "not built yet"), so Today draws its composer and chips
const AGENTS_ON = [
  { agent: "main", state: "idle", job: "Answers and does what you ask.", last_event: null },
  { agent: "lead_finder", state: "idle", job: "Finds new businesses that may want to buy.", last_event: { text: "Found 18 boutiques; 3 need your OK", at: "2026-10-14T04:10:00Z" } },
  { agent: "researcher", state: "working", job: "Reads public pages about a lead.", last_event: { text: "Reading 2 new IndiaMART enquiries", at: "2026-10-14T04:55:00Z" } },
  { agent: "requirement_analyst", state: "idle", job: "Reads an enquiry.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote.", last_event: { text: "Prepared quote 3", at: "2026-10-14T02:00:00Z" } },
  { agent: "followup_desk", state: "working", job: "Drafts follow-ups.", last_event: { text: "5 due today, next at 16:00", at: "2026-10-14T04:30:00Z" } },
  { agent: "order_desk", state: "switched_off", job: "Keeps orders in order.", last_event: null },
];
const extraRoutes = [
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/status$`), json(() => AGENTS_ON)],
  ["GET", /^\/v1\/me$/, json(() => ({ user_id: USER_ID, memberships: [{ role: "owner", tenant: { id: TENANT, name: current.name, slug: "example" } }] }))],
  ["GET", new RegExp(`^${T}$`), json(() => ({ id: TENANT, name: current.name, slug: "example", role: "owner", plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-09-20T00:00:00Z" }))],
  ["GET", new RegExp(`^${T}/lead-finder/availability$`), json(() => (current.finder ? { available: true, source: "fixture", reason: "ok", upgrade_to: null, audience: "businesses" } : { available: false, source: null, reason: "not_for_this_business", upgrade_to: null, audience: "organisations" }))],
  ["GET", new RegExp(`^${T}/nav-counts$`), json(() => ({ needs_you: 5, prospects_needing_owner: current.finder ? 0 : null, new_leads: 12, live_calls: 1, unread_chats: 2, followups_due: 5, visits_today: 2, quotes_waiting: current.id === "education" ? null : 1, ai_team_working: 4, call_minutes: { used: 412, total: 600 }, ai_usage: { used_paise: 6800, allowance_paise: 30000, period: "month" }, plan: "ai_workforce", as_of: "2026-10-14T05:00:00Z" }))],
];

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER }))}`;
}
const connect = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
async function waitForPort(port, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await connect(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}

async function shot(browser, cookie, { file, viewport, scheme, lang, more = false, full = false }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true, colorScheme: scheme, timezoneId: "Asia/Kolkata" });
  await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${WEB_URL}/app/tenants/${TENANT}`, { waitUntil: "networkidle", timeout: 60_000 });
  // the counts arrive after the first paint: wait for one badge (desktop menu or phone bar)
  await page.waitForSelector(viewport.width >= 768 ? '[data-nav-badge="m-leads"]' : '[data-bar-badge="m-leads"]', { timeout: 15_000 }).catch(() => errors.push("no count badge"));
  // the horizontal scroll check of the quality bar
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) errors.push("horizontal scroll");
  if (more) {
    await page.click('[data-bar-tab="more"]');
    await page.waitForSelector("[data-more-sheet]");
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(OUT, file), fullPage: full });
  await context.close();
  return errors;
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "shell-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("shell-shots: building the web app against the stand-in");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    // BROWSER_VOICE (read by the server at request time): Today draws the assistant's composer with the orb, as staging does
    env: { ...process.env, ...webEnv, BROWSER_VOICE: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  let failed = false;
  try {
    await waitForPort(WEB_PORT);
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    const desktop = { width: 1440, height: 1000 };
    const phone = { width: 390, height: 844 };
    for (const p of PACKS) {
      current = p;
      PACK_STATE.pack = p.id;
      PACK_STATE.source = "signup";
      const runs = [
        { file: `desktop-${p.short}-light-en.png`, viewport: desktop, scheme: "light", lang: "en" },
        { file: `desktop-${p.short}-dark-en.png`, viewport: desktop, scheme: "dark", lang: "en" },
        { file: `desktop-${p.short}-full-en.png`, viewport: desktop, scheme: "light", lang: "en", full: true },
        ...(p.short === "sarees" ? [{ file: `desktop-${p.short}-light-te.png`, viewport: desktop, scheme: "light", lang: "te" }] : []),
        { file: `phone-${p.short}-today-en.png`, viewport: phone, scheme: "light", lang: "en" },
        { file: `phone-${p.short}-more-en.png`, viewport: phone, scheme: "light", lang: "en", more: true },
        ...(p.short === "sarees" ? [{ file: `phone-${p.short}-today-te.png`, viewport: phone, scheme: "light", lang: "te" }, { file: `phone-${p.short}-more-te.png`, viewport: phone, scheme: "light", lang: "te", more: true }] : []),
      ];
      for (const run of runs) {
        const errors = await shot(browser, cookie, run);
        console.log(`${errors.length ? "CHECK" : "ok   "} ${run.file}${errors.length ? `: ${errors.join(" | ")}` : ""}`);
        if (errors.length) failed = true;
      }
    }
    await browser.close();
    if (standIn.misses.size) console.log(`shell-shots: the stand-in had no fixture for: ${[...standIn.misses].join(", ")}`);
    console.log(`shell-shots: pictures in ${OUT}`);
  } finally {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

await main();
