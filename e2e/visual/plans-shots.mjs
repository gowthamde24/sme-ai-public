// Pictures of the plan tiers (owner decision 4 Nov: AI Workforce = every feature, Lead Desk = all but the Lead Finder) and of a school's Lead Finder words, from the REAL web app on the visual tests' invented backend
// (stand-in.mjs): no database, no keys, no network after the build, no real person. The web app runs with PLAN_TIER_SCREENS=mock (and PLAN_TIER_MOCK=lead_desk for the Lead Desk scenes) and BROWSER_VOICE=1 (the chat panel);
// it is started again for each scene (the flags are read by the server at request time, so ONE build serves every scene).
//
//   node e2e/visual/plans-shots.mjs [--no-build] [--out DIR] [--only plan-ld,retailers-ld,today-ld,chat-ld,plan-aw,prospects-school]
//
// Saves full-page pictures (390 and 1440 wide, light and dark, English and Telugu) to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-plans). It compares nothing (that is run.mjs).
// Same ports and guards as run.mjs (54999, 3014); it starts and stops only its own processes, by their own process ids.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, PACK_STATE, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ONLY = (arg("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-plans"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const BUILD_FLAGS = { BROWSER_VOICE: "1" };
const T = `/app/tenants/${TENANT}`;
const API = `/v1/tenants/${TENANT}`;

// ---- invented Lead Finder answers (the API's shape; lib/api/lead-finder-fixtures.ts has the same kind) -------------------------------------------------------------
const AT = "2026-10-14T04:00:00Z";
const S1 = "a1a1a1a1-0000-4000-8000-000000000001";
const SEARCH_PLANNED = {
  id: S1, state: "planned", query: "saree shops", area: "Jayanagar Bengaluru", category_hint: "retailer", max_results: 20, provider: "fixture", sku: "fixture", est_cost_paise: 0, cost_paise: 0, cost_is_estimate: false,
  source_label: "Example search (made-up businesses) 'saree shops Jayanagar Bengaluru', 14 Oct", found: 0, counts: null, searches_left_today: 5, attribution: null, created_at: AT, approved_at: null, finished_at: null,
};
const prospect = (n, over) => ({
  id: `b1b1b1b1-0000-4000-8000-00000000000${n}`, search_id: S1, name: "x", category: null, area: null, phone: "+00 000 5123 456" + n, website: null, rating: 4.4, review_count: 120, lat: 17.4, lng: 78.4,
  source: "fixture", source_label: "Example search (made-up organisations) 'organisations near the school', 14 Oct", attribution: null, status: "needs_owner", decision_reason: "first_calls", fit_score: 80, fit_reason: null,
  stock_match: null, owner_approved: false, suppressed: false, ask_after: null, last_contacted_at: null, lead_id: null, qualification: null, created_at: AT, updated_at: AT, ...over,
});
const SCHOOL_PROSPECTS = [
  prospect(1, { name: "Green Meadows Apartment Owners' Association", category: "Apartment association", area: "Kondapur", fit_score: 86, decision_reason: "first_calls" }),
  prospect(2, { name: "Bright Path Coaching Centre", category: "Coaching centre", area: "Madhapur", status: "call_ready", decision_reason: "fit_high", fit_score: 81 }),
  prospect(3, { name: "Kaveri Software Park (staff welfare)", category: "Company", area: "Hitech City", status: "call_ready", decision_reason: "fit_high", fit_score: 77 }),
  prospect(4, { name: "Sunrise Uniforms and Books", category: "School vendor", area: "Gachibowli", status: "skipped", decision_reason: "fit_low", fit_score: 41 }),
];

// ---- the scenes: the server's flags, the stand-in's own answers, and the screens -------------------------------------------------------------------------------------
// the helpers as the visual fixtures have them, with the main assistant on (the chat panel is drawn only where it is live)
const AGENTS_LIVE = [
  { agent: "main", state: "idle", job: "Coordinates the other helpers.", last_event: null },
  { agent: "lead_finder", state: "not_available", job: "Finds new businesses that may want to buy. Not built yet.", last_event: null },
  { agent: "researcher", state: "idle", job: "Reads public pages about a lead and writes down what it finds, with sources.", last_event: null },
  { agent: "requirement_analyst", state: "idle", job: "Reads an enquiry and lists what the customer asked for, to be checked.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote from the prices you set. A person approves it.", last_event: null },
  { agent: "followup_desk", state: "idle", job: "Drafts follow-up messages. A person approves and sends them.", last_event: null },
  { agent: "order_desk", state: "idle", job: "Keeps each order's steps, payments and refunds in order.", last_event: null },
];
const sse = (res, events) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  for (const [name, data] of events) res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
  res.end();
};
const SCENES = {
  ld: { env: { PLAN_TIER_SCREENS: "mock", PLAN_TIER_MOCK: "lead_desk" }, pack: null, availability: { available: true, source: "fixture", reason: "ok" } },
  aw: { env: { PLAN_TIER_SCREENS: "mock" }, pack: null, availability: { available: true, source: "fixture", reason: "ok" } },
  school: { env: { PLAN_TIER_SCREENS: "mock" }, pack: "education", availability: { available: true, source: "fixture", reason: "ok" } },
};
const SCREENS = [
  { id: "plan-ld", scene: "ld", path: `${T}/settings?section=plan` },
  { id: "retailers-ld", scene: "ld", path: `${T}/retailers` },
  { id: "today-ld", scene: "ld", path: T, seeAll: true },
  { id: "chat-ld", scene: "ld", path: T, chat: true },
  { id: "plan-aw", scene: "aw", path: `${T}/settings?section=plan` },
  { id: "prospects-school", scene: "school", path: `${T}/retailers` },
];
const SIZES = { "390": { width: 390, height: 844 }, "1440": { width: 1440, height: 900 } };
const SCHEMES = ["light", "dark"];
const LANGS = ["en", "te"];

let scene = SCENES.ld;
const route = (suffix, answer) => ["GET", new RegExp(`^${API}${suffix}$`), (_req, res) => (res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }), res.end(JSON.stringify(typeof answer === "function" ? answer() : answer)))];
const EXTRA = [
  route("/agents/status", AGENTS_LIVE),
  route("/lead-finder/availability", () => scene.availability),
  route("/prospects", () => ({ items: SCHOOL_PROSPECTS, next_cursor: null })),
  route("/prospects/stats", () => ({ total: 4, by_status: { needs_owner: 1, call_ready: 2, skipped: 1 } })),
  ["POST", new RegExp(`^${API}/prospects/redecide$`), (_req, res) => (res.writeHead(200, { "Content-Type": "application/json" }), res.end(JSON.stringify({ changed: 0 })))],
  route("/me/profile", { display_name: "Visual Owner", address_as: null, preferred_chat_language: "auto", languages: ["en"] }),
  // the chat: "find new retailers ..." on a Lead Desk plan. C1's #317 answers with a `cant_do` work card (drawn by #302's work cards, not on this branch); here the Lead Finder's own plan card arrives,
  // which a Lead Desk workspace draws as the upgrade card (no OK, nothing searched)
  ["POST", new RegExp(`^${API}/assistant/turns$`), (_req, res) =>
    sse(res, [
      ["intent", { kind: "action" }],
      ["text", { delta: "I will look for saree shops in Jayanagar Bengaluru." }],
      ["lead_finder", { search: SEARCH_PLANNED, can_approve: true }],
      ["done", { conversation_id: "55555555-5555-4555-8555-555555555599", message_id: "55555555-5555-4555-8555-555555555598", language: "en", kind: "answer" }],
    ])],
];

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  const session = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER };
  return `base64-${b64url(JSON.stringify(session))}`;
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
async function waitForFree(port, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await connect(port))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`port ${port} still busy after ${ms} ms`);
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "plans-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL, ...BUILD_FLAGS };
  if (!process.argv.includes("--no-build")) {
    console.log("plans-shots: building the web app against the stand-in");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: EXTRA });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  let web = null;
  let log = "";
  const startWeb = async (env) => {
    web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
      cwd: WEB_DIR,
      env: { ...process.env, ...webEnv, ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    web.stdout.on("data", (d) => (log += d));
    web.stderr.on("data", (d) => (log += d));
    await waitForPort(WEB_PORT);
  };
  const stopWeb = async () => {
    if (!web) return;
    const p = web;
    web = null;
    await new Promise((resolve) => {
      p.once("exit", resolve);
      try {
        p.kill("SIGTERM"); // our own child, by its own process id
      } catch {
        resolve();
      }
    });
    await waitForFree(WEB_PORT);
  };
  const stop = async () => {
    await stopWeb().catch(() => null);
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  process.on("SIGINT", () => stop().then(() => process.exit(130)));
  const rows = [];
  const defaultPack = PACK_STATE.pack;
  try {
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const [sceneId, sc] of Object.entries(SCENES)) {
      const screens = SCREENS.filter((s) => s.scene === sceneId && (!ONLY.length || ONLY.includes(s.id)));
      if (!screens.length) continue;
      scene = sc;
      PACK_STATE.pack = sc.pack ?? defaultPack;
      await startWeb(sc.env);
      for (const screen of screens)
        for (const [size, viewport] of Object.entries(SIZES))
          for (const scheme of SCHEMES)
            for (const lang of LANGS) {
              const name = `${screen.id}-${size}-${scheme}-${lang}`;
              const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce", locale: lang === "te" ? "te-IN" : "en-IN", timezoneId: "Asia/Kolkata", isMobile: size === "390", hasTouch: size === "390" });
              await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
              const page = await context.newPage();
              const errors = [];
              page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
              try {
                const res = await page.goto(`${WEB_URL}${screen.path}`, { waitUntil: "networkidle", timeout: 60_000 });
                await page.evaluate(() => document.fonts.ready);
                if (screen.seeAll) {
                  // the upsell row is the last one: open the whole list
                  const all = page.locator("section:has(h2) button", { hasText: /\(\d+\)/ }).first();
                  if (await all.count()) await all.click();
                  await page.locator('[data-needs-row="plan_upsell-lead_finder"], #needs-full-plan_upsell-lead_finder').first().scrollIntoViewIfNeeded();
                }
                if (screen.chat) {
                  const box = page.locator('[data-chat="form"] textarea').first();
                  await box.waitFor({ timeout: 20_000 });
                  await box.fill(lang === "te" ? "Jayanagar లో కొత్త retailers వెతుకు" : "find new retailers in Jayanagar");
                  await box.press("Enter");
                  await page.locator('[data-chat="upsell"]').first().waitFor({ timeout: 20_000 });
                  await page.locator('[data-chat="upsell"]').first().scrollIntoViewIfNeeded();
                }
                await page.waitForTimeout(400);
                await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !screen.chat, animations: "disabled", caret: "hide" });
                const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
                const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
                const flags = [res?.status() !== 200 ? `HTTP ${res?.status()}` : "", wide ? "horizontal scroll" : "", /machine[- ]translat|translated automatically/i.test(body) ? "machine-translation notice" : "", /\b(tier|lf|today|plan)\.[a-z_]+(\.[a-z_]+)?\b/.test(body.replace(/\S+@\S+|https?:\S+/g, "")) ? "maybe a raw key" : "", errors.length ? `page errors: ${errors.join(" | ")}` : ""].filter(Boolean);
                rows.push(`${flags.length ? "CHECK" : "ok   "} ${name}${flags.length ? `  ${flags.join("; ")}` : ""}`);
              } catch (e) {
                const seen = await page.locator("body").innerText().catch(() => "");
                rows.push(`ERROR ${name}: ${String(e.message).split("\n")[0]} | page says: ${seen.replace(/\s+/g, " ").slice(0, 300)}`);
              }
              await context.close();
            }
      await stopWeb();
    }
    await browser.close();
    console.log(rows.join("\n"));
    if (standIn.misses.size) console.log(`\nplans-shots: the stand-in had no fixture for:\n  ${[...standIn.misses].sort().join("\n  ")}`);
  } catch (e) {
    console.error(`plans-shots: ${e.message}\n--- web log (tail) ---\n${log.slice(-1500)}`);
  } finally {
    PACK_STATE.pack = defaultPack;
    await stop();
  }
}

main();
