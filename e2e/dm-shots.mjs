// Job DM: the redesign in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs): the public landing page in four languages (light and dark, 1280 and 390 px), How it works, a business
// type's page, and the app screens the job changed: Today (the bottom Ask bar, "Live now", today's outcomes), voice mode (the full-screen circle, opened by the microphone), the live call, an outcome timeline on a customer, Settings > AI assistant
// and the Office board. The three new screens run with CALL_SCREENS, OUTCOME_SCREENS and ASSISTANT_SCREENS = mock (fake data kept in cookies: nothing is called, nothing is stored on a server).
//   node e2e/dm-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dm)
// It CHECKS what it shows and exits 1 with the list if one fails: the expected words, no owl picture, no {token}, no sideways scroll at 390 px, no console error, a rupee sign only where money belongs (never on the public site).
// Port 3017 (web) and 54999 (the stand-in): never run it at the same time as the other shots scripts; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, LEAD, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dm"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3017;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };

const b64url = (x) => Buffer.from(x).toString("base64url");
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


const FLAGS = { CALL_SCREENS: "mock", OUTCOME_SCREENS: "mock", ASSISTANT_SCREENS: "mock" };
const LANGS = ["te", "hi", "kn"];
const app = (p) => `${WEB_URL}/app/tenants/${TENANT}${p}`;

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dm-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("dm-shots: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  // the stand-in says Vijaya is "not built yet", so the Ask box would not be drawn; for these pictures the main assistant is on (the same list, one state changed)
  const agents = [{ agent: "main", state: "idle", job: "Coordinates the other helpers.", last_event: null }, ...["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"].map((agent, i) => ({ agent, state: i === 2 ? "working" : i === 0 ? "not_available" : "idle", job: `The ${agent.replace("_", " ")} helper.`, last_event: null }))];
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: [["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/status$`), (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(agents)); }]] });
  const written = [];
  const problems = [];
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  let web = null;
  const startWeb = async (flags) => {
    const env = { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW };
    for (const k of Object.keys(FLAGS)) delete env[k];
    Object.assign(env, flags);
    web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], { cwd: WEB_DIR, env, stdio: "ignore" });
    await waitForPort(WEB_PORT);
  };
  const stopWeb = async () => {
    if (!web) return;
    web.kill("SIGTERM"); // our own child, by its own process id
    await new Promise((r) => web.on("exit", r));
    web = null;
    await sleep(400);
  };
  let browser = null;
  const session = sessionCookieValue();
  const open = async ({ scheme, sizeName, lang }) => {
    const size = SIZES[sizeName];
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", permissions: ["microphone"], isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
    await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: session, url: WEB_URL }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|NotAllowedError/.test(m.text()) && errors.push(m.text().slice(0, 200)));
    return { context, page, errors };
  };
  const common = async (tag, label, page, errors, sizeName, opts = {}) => {
    const text = await page.locator("body").innerText();
    if (sizeName === "phone") check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways at 390 px`);
    check(errors.length === 0, `${tag} ${label}: console errors: ${errors.join(" | ")}`);
    check(!/\{[a-z_]+\}/.test(text), `${tag} ${label}: a {token} is on the page`);
    check((await page.locator('img[src*="owl"]').count()) === 0, `${tag} ${label}: an owl picture is on the page`);
    if (opts.noMoney) check(!/₹|\bRs\.?\s?\d/.test(text), `${tag} ${label}: money is on the public site`);
    return text;
  };
  const save = async (page, name, tag, note, opts = {}) => {
    const file = path.join(OUT, `${name}-${tag}.png`);
    await page.screenshot({ path: file, fullPage: true, ...opts });
    written.push(`${path.basename(file)}  (${note})`);
  };
  const has = (tag, label, text, words) => {
    for (const w of words) check(text.toLowerCase().includes(w.toLowerCase()), `${tag} ${label}: "${w}" is missing`);
  };
  try {
    browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

    // 1. the flags OFF: the three new screens are not there
    await startWeb({});
    {
      const { context, page, errors } = await open({ scheme: "light", sizeName: "desktop", lang: "en" });
      await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
      check((await page.locator('[data-settings="assistant"]').count()) === 0, "off: ?section=assistant drew the AI assistant part");
      check(!(await page.locator('nav[aria-label="Parts of Settings"]').innerText()).includes("AI assistant"), "off: the AI assistant tab is there");
      await page.goto(app("/"), { waitUntil: "networkidle" });
      check((await page.locator('[data-part="live-now"], [data-part="outcomes-today"]').count()) === 0, "off: Live now or the outcome totals are on Today");
      await page.goto(app("/office/live"), { waitUntil: "networkidle" });
      { const body = await page.locator("body").innerText(); check(/could not find|not found/i.test(body), `off: the live call page did not say 'not found': ${body.slice(0, 160).replaceAll("\n", " | ")}`); }
      check(errors.filter((e) => !/404/.test(e)).length === 0, `off: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    await stopWeb();

    // 2. the public site (no flag needed): landing in four languages, how it works and a business type's page
    await startWeb(FLAGS);
    for (const scheme of ["light", "dark"]) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `${scheme}-${sizeName}`;
        const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
        await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
        const text = await common(tag, "landing", page, errors, sizeName, { noMoney: true });
        has(tag, "landing", text, ["Your AI workforce for Indian SMEs.", "Find leads", "AI calls", "Outcome", "Follow-up", "Up and running in an afternoon.", "Natural AI calls", "Price at launch", "Put your AI workforce to work.", "Start your 14-day trial"]);
        check((await page.locator("h1").count()) === 1, `${tag} landing: not one h1`);
        check((await page.locator('[data-orb="still"]').count()) >= 1, `${tag} landing: the circle logo is missing`);
        await save(page, "landing", `${tag}-en`, "the new landing page");
        await context.close();
      }
    }
    for (const lang of LANGS) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `light-${sizeName}-${lang}`;
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang });
        await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
        const text = await common(tag, "landing", page, errors, sizeName, { noMoney: true });
        const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
        check(script.test(text), `${tag} landing: no ${lang} script`);
        check(!/Your AI workforce for Indian SMEs/.test(text), `${tag} landing: the English headline is on the ${lang} page`);
        await save(page, "landing", tag, `the landing page in ${lang} (draft words)`);
        await context.close();
      }
    }
    for (const [name, url, words] of [["how-it-works", "/how-it-works", ["Find leads", "AI calls", "WhatsApp", "Outcome", "Follow-up"]], ["business-education", "/education", ["A day with your AI team"]]]) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `light-${sizeName}-en`;
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        const res = await page.goto(`${WEB_URL}${url}`, { waitUntil: "networkidle" });
        check(res.status() === 200, `${tag} ${name}: answered ${res.status()}`);
        const text = await common(tag, name, page, errors, sizeName, { noMoney: true });
        has(tag, name, text, words);
        await save(page, name, tag, name);
        await context.close();
      }
    }

    // 3. the app: Today (bottom Ask bar, Live now, outcome totals), voice mode, the live call, an outcome timeline, Settings > AI assistant, the Office board
    for (const scheme of ["light", "dark"]) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `${scheme}-${sizeName}-en`;
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.goto(app("/"), { waitUntil: "networkidle" });
          const text = await common(tag, "today", page, errors, sizeName);
          has(tag, "today", text, ["Outcomes today", "7 positive", "3 not interested", "2 unclear", "Calling Ravi Kumar", "Listen"]);
          const bar = await page.locator('[data-ask="live"] form').boundingBox();
          const view = page.viewportSize();
          check(bar !== null && bar.y + bar.height > view.height - 140, `${tag} today: the Ask bar is not at the bottom of the screen (y ${bar && Math.round(bar.y)}, height ${view.height})`);
          await save(page, "today", tag, "Today: the Ask bar at the bottom, Live now, today's outcomes", { fullPage: false });
          await context.close();
        }
        {
          // voice mode: the microphone opens the full-screen circle (voice is "available" for this picture: the stand-in has no voice route)
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.route("**/ask/voice", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { available: true, speech: false } }) : route.continue()));
          await page.goto(app("/"), { waitUntil: "networkidle" });
          await page.locator('[data-voice="mic"]').click();
          await page.locator('[data-voice="mode"]').waitFor({ timeout: 15000 });
          await page.waitForTimeout(600);
          const text = await page.locator('[data-voice="mode"]').innerText();
          has(tag, "voice mode", text, ["I'm listening…", "Done", "Never mind"]);
          const orb = await page.locator('[data-voice="mode"] [data-orb]').boundingBox();
          check(orb !== null && orb.width >= 200, `${tag} voice mode: the circle is not big (${orb && Math.round(orb.width)} px)`);
          check(errors.length === 0, `${tag} voice mode: console errors ${errors.join(" | ")}`);
          await save(page, "voice-mode", tag, "voice mode: the full-screen circle while it listens", { fullPage: false });
          await context.close();
        }
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          const res = await page.goto(app("/office/live"), { waitUntil: "networkidle" });
          const text = await common(tag, "live call", page, errors, sizeName);
          if (!text.includes("Ravi Kumar")) {
            await save(page, "debug-live-call", tag, "DEBUG");
            problems.push(`${tag} live call: status ${res.status()}, url ${page.url()}, text: ${text.replaceAll("\n", " | ").slice(0, 500)}`);
            await context.close();
            continue;
          }
          has(tag, "live call", text, ["Ravi Kumar", "Take over the call", "End call", "Show full transcript", "Test mode: this is a pretend call. Nobody is called."]);
          await save(page, "live-call", tag, "the live call (a pretend one): the circle, the caption, Take over, End call");
          await page.getByRole("button", { name: "Show full transcript" }).click();
          await save(page, "live-call-transcript", tag, "the live call with the transcript open");
          await context.close();
        }
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.goto(app(`/leads/${LEAD}`), { waitUntil: "networkidle" });
          const text = await common(tag, "outcomes", page, errors, sizeName);
          has(tag, "outcomes", text, ["Outcomes", "After every call and every WhatsApp follow-up", "Positive", "Correct this"]);
          await save(page, "outcomes-customer", tag, "a customer's outcomes: result, kind and reason, with 'Correct this'");
          await context.close();
        }
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
          const text = await common(tag, "assistant", page, errors, sizeName);
          has(tag, "assistant", text, ["Set up your AI assistant", "Voice", "Languages", "Way of talking", "What it may do on calls", "Hand over to you", "Calling hours", "Call me now for a test", "Preview"]);
          check(/the AI assistant of /.test(text), `${tag} assistant: the name line does not say "the AI assistant of ..."`);
          await save(page, "ai-assistant", tag, "Settings > AI assistant: the defaults, the live preview with the circle");
          await context.close();
        }
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.goto(app("/office"), { waitUntil: "networkidle" });
          const text = await common(tag, "office", page, errors, sizeName);
          has(tag, "office", text, ["Agent office", "Board view", "List view"]);
          check((await page.locator('[data-office="team"] li').count()) === 7, `${tag} office: not seven tiles`);
          await save(page, "office-board", tag, "the Office: the team board with the circle and the job icons");
          await context.close();
        }
      }
    }
    for (const lang of LANGS) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `light-${sizeName}-${lang}`;
        const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
        for (const [name, url] of [["ai-assistant", "/settings?section=assistant"], ["live-call", "/office/live"], ["outcomes-customer", `/leads/${LEAD}`]]) {
          const { context, page, errors } = await open({ scheme: "light", sizeName, lang });
          await page.goto(app(url), { waitUntil: "networkidle" });
          const text = await common(tag, name, page, errors, sizeName);
          check(script.test(text), `${tag} ${name}: no ${lang} script`);
          await save(page, name, tag, `${name} in ${lang} (draft words)`);
          await context.close();
        }
      }
    }
    // 4. a correction of an outcome, with real clicks
    for (const sizeName of Object.keys(SIZES)) {
      const tag = `light-${sizeName}-en`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
      await page.goto(app(`/leads/${LEAD}`), { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Correct this" }).first().click();
      await page.getByLabel("Result").first().selectOption("negative");
      await page.getByLabel("What happened").first().selectOption("too_costly");
      await save(page, "outcome-correct-form", tag, "correcting an outcome: the form");
      await page.getByRole("button", { name: "Save" }).first().click();
      await page.getByText("You corrected this.").waitFor({ timeout: 15000 });
      await save(page, "outcome-corrected", tag, "the outcome says the owner corrected it");
      check(errors.length === 0, `${tag} correction: console errors ${errors.join(" | ")}`);
      await context.close();
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`dm-shots: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => null);
    await stopWeb();
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n${problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : ""}`);
  console.log(`${written.length} pictures in ${OUT}${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();
