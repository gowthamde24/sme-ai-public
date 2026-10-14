// Job CJ: pictures of the plush owl team in the places people see it: Today, the Ask box, the team page, Agent settings (the scheduler card) and the plush Office, light and dark, on a laptop (1280 x 900) and on a
// 390 px phone, from the real web app (a production build) on the visual tests' invented backend.
//   node e2e/cj-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-cj)
// For the Office the helpers' states are set the way the API gives them: Agent OWL idle, the quote writer WORKING (glowing laptop), the researcher SWITCHED OFF (faded, still), the lead finder not built, the rest idle.
// Port 3016 (web) and 54999 (the stand-in): the same as `make perf`, so never run both at once; it stops only its own two processes.
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
const ONLY = arg("only", "").split(",").filter(Boolean); // --only today,team,settings,office
const want = (name) => ONLY.length === 0 || ONLY.includes(name);
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-cj"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const TODAY = `${WEB_URL}/app/tenants/${TENANT}`;
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };

// the main agent's state decides whether the owl rests (the fixture says "not_available": resting) or is idle; flipped in place
const agents = API_ROUTES.find(([pattern]) => pattern.test(`/v1/tenants/${TENANT}/agents/status`))?.[1];
if (!Array.isArray(agents) || agents[0]?.agent !== "main") throw new Error("the fixture's agents/status is not the list this script expects");
// the scheduler card of Agent settings: the fixture says "not working"; the shot shows it working (Agent OWL with its dot lit)
const scheduler = API_ROUTES.find(([pattern]) => pattern.test(`/v1/tenants/${TENANT}/scheduler/status`))?.[1];
if (scheduler && typeof scheduler === "object") scheduler.active = true;
const setState = (agent, state) => void (agents.find((a) => a.agent === agent).state = state);
const setOfficeStates = () => {
  setState("main", "idle");
  setState("quote_writer", "working");
  setState("researcher", "switched_off");
};

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cj-shots-"));
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
          return { context, page, errors };
        };
        const save = async (target, name, note, opts = {}) => {
          const file = path.join(OUT, `${name}-${scheme}-${sizeName}.png`);
          await target.screenshot({ path: file, ...opts });
          written.push(`${path.basename(file)}  (${note})`);
        };
        const allLive = (page, selector) => page.waitForFunction((sel) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every((e) => e.getAttribute("data-plush") === "live"), selector, { timeout: 45_000 });
        const scrollThrough = async (page, selector) => {
          for (const el of await page.locator(selector).all()) await el.scrollIntoViewIfNeeded();
        };

        setOfficeStates();
        let s;

        // Today (the whole page) and the Ask box (the Agent OWL card), Agent OWL sky blue and alive
        if (want("today")) {
          s = await newPage();
          await s.page.goto(TODAY, { waitUntil: "networkidle" });
          await allLive(s.page, '[data-part="agent-owl"] .plush');
          await sleep(1200);
          await save(s.page, "today", "Today, whole page", { fullPage: true });
          await save(s.page.locator('[data-part="agent-owl"]'), "ask-box", "the Agent OWL card with the Ask box, idle");
          problems.push(...s.errors.map((e) => `${sizeName}/${scheme} today: ${e}`));
          await s.context.close();
        }

        // the team page (the people, each with an owl of the seven)
        if (want("team")) {
          s = await newPage();
          await s.page.goto(`${TODAY}/team`, { waitUntil: "networkidle" });
          await s.page.locator("[data-team=members]").waitFor({ timeout: 30_000 });
          await sleep(600);
          await save(s.page, "team", "the team page: each person with an owl", { fullPage: true });
          problems.push(...s.errors.map((e) => `${sizeName}/${scheme} team: ${e}`));
          await s.context.close();
        }

        // Agent settings: Agent OWL's scheduler card
        if (want("settings")) {
          s = await newPage();
          await s.page.goto(`${TODAY}/settings?section=agent`, { waitUntil: "networkidle" });
          await s.page.locator('[data-card="scheduler"]').waitFor({ timeout: 30_000 });
          await sleep(600);
          await save(s.page, "agent-settings", "Agent settings, the scheduler card with Agent OWL", { fullPage: true });
          problems.push(...s.errors.map((e) => `${sizeName}/${scheme} agent settings: ${e}`));
          await s.context.close();
        }

        // the plush Office: moving (working types, idle breathes, off is faded and still), then with reduced motion (every owl a still picture)
        if (want("office")) {
          for (const reduced of [false, true]) {
            s = await newPage({ reduced });
            await s.page.goto(`${TODAY}/office`, { waitUntil: "networkidle" });
            await s.page.evaluate(() => localStorage.removeItem("sme_office_view"));
            await s.page.reload({ waitUntil: "networkidle" });
            await s.page.locator(".office-seat").first().waitFor({ timeout: 30_000 });
            if (!reduced) {
              await scrollThrough(s.page, ".office-seat");
              await s.page.waitForFunction(() => [...document.querySelectorAll(".office-seat:not([data-pose=off]) .plush")].every((e) => e.getAttribute("data-plush") === "live"), null, { timeout: 45_000 });
            } else await sleep(2500);
            await s.page.locator(".office-wrap").scrollIntoViewIfNeeded();
            await sleep(1300);
            const states = await s.page.locator(".office-seat .plush").evaluateAll((els) => els.map((e) => `${e.dataset.agent}:${e.dataset.plush}${e.dataset.working === "true" ? "+typing" : ""}`));
            await save(s.page.locator(".office-wrap"), reduced ? "office-reduced-motion" : "office", `the plush office${reduced ? ", reduced motion" : ""}: ${states.join(" ")}`);
            if (reduced && states.some((x) => !x.endsWith(":still"))) problems.push(`${sizeName}/${scheme} office reduced motion: an owl was not a still picture (${states.join(" ")})`);
            if (!reduced && !states.some((x) => x.startsWith("quote_writer:live+typing"))) problems.push(`${sizeName}/${scheme} office: the working helper was not typing (${states.join(" ")})`);
            problems.push(...s.errors.map((e) => `${sizeName}/${scheme} office: ${e}`));
            await s.context.close();
          }
        }
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
