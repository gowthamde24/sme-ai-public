// Job CI: pictures of the plush owlet in each of its five moods, light and dark, on a laptop and on a 390 px phone, from the real web app (a production build) on the visual tests' invented backend.
//   node e2e/ci-owl-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-ci)
// The moods are made the way a person makes them, with nothing of the page changed: resting = the main agent is not available (the fixture's own state); idle = it is; listening = the Ask box has focus and
// something typed; thinking = the question is sent and no word has come yet; answering = words are streaming. The answer's stream is a stand-in made in the page (it replaces `fetch` for the app's own /ask
// route, and the test pushes the events), because the visual stand-in is read-only. Port 3016 (web) and 54999 (the stand-in): the same as `make perf`, so never run both at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { API_ROUTES, FIXED_NOW, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-ci"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const TODAY = `${WEB_URL}/app/tenants/${TENANT}`;
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };

// the main agent's state decides whether the owl rests (the fixture says "not_available": resting) or is idle; flipped in place
const agents = API_ROUTES.find(([pattern]) => pattern.test(`/v1/tenants/${TENANT}/agents/status`))?.[1];
if (!Array.isArray(agents) || agents[0]?.agent !== "main") throw new Error("the fixture's agents/status is not the list this script expects");
const setMain = (state) => void (agents[0].state = state);

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("shots-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800, iat: 1790000000 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "shots-refresh", user: SESSION_USER }))}`;
}
const portBusy = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
  s.on("error", () => resolve(false));
});
async function waitForPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port}`);
}

// in the page, before any script: the answer of the Ask box is a stream the test controls (window.__ask.push(event), window.__ask.end())
const ASK_STREAM = `(() => {
  const real = window.fetch.bind(window);
  window.__ask = { sent: 0, push: () => {}, end: () => {} };
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!/\\/ask$/.test(new URL(url, location.href).pathname)) return real(input, init);
    window.__ask.sent += 1;
    const enc = new TextEncoder();
    let ctl;
    const body = new ReadableStream({ start(c) { ctl = c; } });
    window.__ask.push = (e) => ctl.enqueue(enc.encode(JSON.stringify(e) + "\\n"));
    window.__ask.end = () => { try { ctl.close(); } catch {} };
    return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ci-owl-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("shots: building the web app (a minute or two)");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem") });
  const web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let webLog = "";
  web.stdout.on("data", (d) => (webLog += d));
  web.stderr.on("data", (d) => (webLog += d));
  const stop = async () => {
    try {
      web.kill("SIGTERM"); // our own child, by its own process id
    } catch {
      // already gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  const written = [];
  const problems = [];
  try {
    await waitForPort(WEB_PORT);
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const scheme of ["light", "dark"]) {
      for (const [sizeName, viewport] of Object.entries(SIZES)) {
        const newPage = async ({ reduced = false } = {}) => {
          const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
          page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
          await page.addInitScript(ASK_STREAM);
          return { context, page, errors };
        };
        const card = (page) => page.locator('[data-part="agent-owl"]');
        const owl = (page) => card(page).locator(".plush").first();
        const live = async (page) => {
          await owl(page).waitFor({ timeout: 30_000 });
          await page.waitForFunction(() => document.querySelector('[data-part="agent-owl"] .plush')?.getAttribute("data-plush") === "live", null, { timeout: 30_000 });
        };
        const shoot = async (page, mood, extra = "") => {
          await sleep(1400); // a moment of the movement, not the first frame
          const file = path.join(OUT, `${mood}${extra}-${scheme}-${sizeName}.png`);
          await card(page).screenshot({ path: file });
          const state = await owl(page).evaluate((el) => ({ mood: el.dataset.mood, stage: el.dataset.plush, motion: el.dataset.motion }));
          written.push(`${path.basename(file)}  (${state.mood}, ${state.stage}, motion ${state.motion})`);
          if (state.mood !== mood || state.stage !== "live") problems.push(`${path.basename(file)}: the owl was ${state.mood}/${state.stage}`);
        };

        // resting: the main agent is not available
        setMain("not_available");
        let s = await newPage();
        await s.page.goto(TODAY, { waitUntil: "networkidle" });
        await live(s.page);
        await shoot(s.page, "resting");
        problems.push(...s.errors.map((e) => `${sizeName}/${scheme} resting: ${e}`));
        await s.context.close();

        // idle, listening, thinking, answering: the main agent is idle; one page, in order
        setMain("idle");
        s = await newPage();
        await s.page.goto(TODAY, { waitUntil: "networkidle" });
        await live(s.page);
        await s.page.mouse.move(viewport.width * 0.3, viewport.height * 0.7); // the owl looks toward the pointer
        await shoot(s.page, "idle");
        const input = s.page.locator("#ask-input");
        await input.click();
        await input.pressSequentially("Which customers should I follow up with today?", { delay: 8 });
        await shoot(s.page, "listening");
        await input.press("Enter");
        await s.page.waitForFunction(() => window.__ask.sent === 1);
        await shoot(s.page, "thinking"); // sent, nothing has come back
        const words = ["Three customers are waiting for a reply. ", "Lakshmi Silks asked about a Kanchipuram order, ", "and a quote for her is ready for your approval. "];
        const feed = (async () => {
          for (const w of words) {
            await s.page.evaluate((delta) => window.__ask.push({ type: "text", delta }), w);
            await sleep(900);
          }
        })();
        await sleep(500);
        await shoot(s.page, "answering"); // words are streaming
        await feed;
        await s.page.evaluate(() => {
          window.__ask.push({ type: "done" });
          window.__ask.end();
        });
        problems.push(...s.errors.map((e) => `${sizeName}/${scheme} moods: ${e}`));
        await s.context.close();

        // with reduced motion: the same owl, a third of the movement, no flutter
        s = await newPage({ reduced: true });
        await s.page.goto(TODAY, { waitUntil: "networkidle" });
        await live(s.page);
        await shoot(s.page, "idle", "-reduced-motion");
        await s.context.close();

        // the landing page's owl (no sign-in): idle, in the hero
        const landing = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 2, colorScheme: scheme, locale: "en-IN", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
        await landing.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }]);
        const lp = await landing.newPage();
        await lp.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
        const hero = lp.locator(".plush").first();
        await hero.waitFor({ timeout: 30_000 });
        await lp.waitForFunction(() => document.querySelector(".plush")?.getAttribute("data-plush") === "live", null, { timeout: 30_000 });
        await sleep(1400);
        const file = path.join(OUT, `landing-hero-${scheme}-${sizeName}.png`);
        await hero.locator("xpath=..").screenshot({ path: file });
        written.push(`${path.basename(file)}  (landing hero, idle)`);
        await landing.close();
      }
    }
    await browser.close();
    if (standIn.misses.size) console.log(`shots: the stand-in had no fixture for: ${[...standIn.misses].sort().join(", ")}`);
  } catch (error) {
    problems.push(error.message);
    console.error(`shots: ${error.message}\n--- web log (tail) ---\n${webLog.slice(-1500)}`);
    process.exitCode = 1;
  } finally {
    await stop();
  }
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n${problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : ""}`);
  console.log(`${written.join("\n")}\n${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();
