// Pictures of the demo video (job demo-video), one per step, from the REAL web app on the visual tests' invented backend (stand-in.mjs): no database, no keys, no network after the build, no real person.
// The web app runs with DEMO_VIDEO=on; the stand-in says the workspace is a demo one (`demo: true` on billing/access) only when asked to, so the guard is tried both ways first.
//
//   node e2e/visual/demo-video-shots.mjs [--no-build] [--out DIR]
//
// Plays the story with the presenter's keys (the right arrow) at 1440x900 and 390x844, light (and dark at 1440), and saves one viewport picture per step to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-demo).
// It also checks each step's words: no "example", no "DEMO", no "made-up businesses", no raw word key, no sideways scroll, no plan line in the menu, no count on the bell and no request for notifications. Same ports and guards as run.mjs (54999, 3014); it stops only its own processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-demo"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const FLAGS = { DEMO_VIDEO: "on" };
const URL_VIDEO = `${WEB_URL}/app/tenants/${TENANT}?demo=video`;
const RUNS = [
  { size: "1440", viewport: { width: 1440, height: 900 }, scheme: "light" },
  { size: "390", viewport: { width: 390, height: 844 }, scheme: "light" },
  { size: "1440", viewport: { width: 1440, height: 900 }, scheme: "dark" },
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

// the guard's third question: the API's own word that this is a demo workspace (switched by the script)
let apiSaysDemo = false;
const extraRoutes = [
  [
    "GET",
    new RegExp(`^/v1/tenants/${TENANT}/billing/access$`),
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ access: "full", read_only_since: null, delete_on: null, data_days_left: null, can_resume: false, sending: "on", waiting_for: null, demo: apiSaysDemo }));
    },
  ],
];

/** The story, beat by beat: what to press (the right arrow) and what must be on screen before the picture. `shot` = the picture of the step. */
const PLAY = [
  { shot: "1-today", wait: '[data-dv-beat="today"] [data-screen="today"]' },
  { press: true, shot: "2-new-lead", wait: '[data-dv-beat="lead"] [data-needs-row^="outbox_approval-"]' },
  { press: true, shot: "3-telugu-reply", wait: '[data-dv-beat="reply"] [data-part="gloss"]' },
  { press: true, shot: "4a-approved", wait: '[data-dv-beat="sent"]', settle: 700 },
  { shot: "4b-chat", wait: '[data-dv-beat="chat"][data-dv-answered]', settle: 400 },
  { press: true, shot: "5a-finder", wait: '[data-dv-beat="finder"] [data-finder]' },
  { press: true, shot: "5b-plan", wait: '[data-dv-beat="plan"] [data-plan-card]' },
  { press: true, shot: "5c-found", wait: '[data-dv-beat="found"] [data-result-card]' },
  { press: true, wait: '[data-dv-beat="call"]' },
  { press: true, wait: '[data-dv-beat="start"]' },
  { press: true, shot: "6-practice-call", wait: '[data-dv-beat="quote"] [data-practice-result]' },
  { shot: "7a-draft-quote", wait: "[data-draft-make]" },
  { press: true, shot: "7b-draft-made", wait: '[data-dv-beat="made"] [data-draft-made]' },
  { press: true, shot: "8-done-while-you-slept", wait: '[data-dv-beat="done"] [data-part="done"]', settle: 600 },
];

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dv-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL, ...FLAGS };
  if (!process.argv.includes("--no-build")) {
    console.log("demo-video-shots: building the web app against the stand-in");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  web.stdout.on("data", (d) => (log += d));
  web.stderr.on("data", (d) => (log += d));
  const stop = async () => {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  process.on("SIGINT", () => stop().then(() => process.exit(130)));
  const rows = [];
  let failed = false;
  try {
    await waitForPort(WEB_PORT);
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    const contextFor = async (viewport, scheme, size) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: size === "390", hasTouch: size === "390" });
      await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
      return context;
    };

    // the guard: the API does not call it a demo workspace -> the address is the normal Today, no story
    {
      apiSaysDemo = false;
      const context = await contextFor(RUNS[0].viewport, "light", "1440");
      const page = await context.newPage();
      await page.goto(URL_VIDEO, { waitUntil: "networkidle", timeout: 60_000 });
      const stage = await page.locator("[data-dv-stage]").count();
      const name = await page.locator("body").innerText();
      rows.push(`${stage === 0 && name.includes("Sri Visual Silks") ? "ok   " : "CHECK"} guard: not a demo workspace -> the normal Today (story drawn: ${stage > 0}; frame keeps the real name: ${name.includes("Sri Visual Silks")})`);
      if (stage !== 0) failed = true;
      await context.close();
    }

    apiSaysDemo = true;
    for (const { size, viewport, scheme } of RUNS) {
      const context = await contextFor(viewport, scheme, size);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      // the bell asks nothing while the story plays (the workspace's real notices must not reach the recording)
      const asked = [];
      page.on("request", (r) => /\/notifications(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search) && asked.push(r.url()));
      // a screen other than Today asked with ?demo=video starts the story at step 1
      await page.goto(`${WEB_URL}/app/tenants/${TENANT}/retailers?demo=video`, { waitUntil: "networkidle", timeout: 60_000 });
      const landed = new URL(page.url());
      if (landed.pathname !== `/app/tenants/${TENANT}/demo-video`) {
        rows.push(`CHECK ${size}-${scheme}: the other screen did not start the story (${landed.pathname}${landed.search})`);
        failed = true;
      }
      await page.evaluate(() => document.fonts.ready);
      for (const beat of PLAY) {
        try {
          if (beat.press) await page.keyboard.press("ArrowRight");
          await page.waitForSelector(beat.wait, { timeout: 15_000 });
          await page.waitForTimeout(beat.settle ?? 350);
          if (!beat.shot) continue;
          const name = `dv-${beat.shot}-${size}-${scheme}`;
          await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
          const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          const badge = await page.locator('[data-notify="count"]').count();
          const flags = [badge ? "a count on the bell" : "", asked.length ? "the bell asked for notifications" : "", /\b[A-Z][a-z]+( [a-z]+)? plan\b/.test(await page.locator("aside").first().innerText().catch(() => "")) ? "a plan line in the menu" : "", wide ? "horizontal scroll" : "", /\bexamples?\b/i.test(body) ? "the word example" : "", /\bDEMO\b|synthetic/.test(body) ? "a DEMO / synthetic label" : "", /made-up businesses/i.test(body) ? "made-up businesses label" : "", /\b[a-z]+\.[a-z_]+\.[a-z_]+\b/.test(body.replace(/\S+@\S+|https?:\S+/g, "")) ? "maybe a raw key" : "", errors.length ? `page errors: ${errors.join(" | ")}` : ""].filter(Boolean);
          if (flags.length) failed = true;
          rows.push(`${flags.length ? "CHECK" : "ok   "} ${name}${flags.length ? `  ${flags.join("; ")}` : ""}`);
        } catch (e) {
          failed = true;
          rows.push(`ERROR ${size}-${scheme} at ${beat.wait}: ${String(e.message).split("\n")[0]}`);
          await page.screenshot({ path: path.join(OUT, `dv-error-${size}-${scheme}.png`) }).catch(() => null);
          break;
        }
      }
      // R starts again at step 1 at once
      await page.keyboard.press("r");
      const back = await page.locator('[data-dv-beat="today"] [data-screen="today"]').count();
      rows.push(`${back ? "ok   " : "CHECK"} ${size}-${scheme}: R is back at step 1`);
      if (!back) failed = true;
      await context.close();
    }
    await browser.close();
    console.log(rows.join("\n"));
    const sent = standIn.hits.filter((h) => !h.startsWith("GET "));
    console.log(sent.length ? `\ndemo-video-shots: CHECK the stand-in was asked to change something:\n  ${sent.join("\n  ")}` : "\ndemo-video-shots: nothing but reads reached the stand-in (no POST/PUT/DELETE)");
    if (sent.length) failed = true;
    if (standIn.misses.size) console.log(`\ndemo-video-shots: the stand-in had no fixture for:\n  ${[...standIn.misses].sort().join("\n  ")}`);
  } catch (e) {
    failed = true;
    console.error(`demo-video-shots: ${e.message}\n--- web log (tail) ---\n${log.slice(-1500)}`);
  } finally {
    await stop();
  }
  process.exit(failed ? 1 : 0);
}

main();
