// Job DN: the assistant's name and the Ask dock in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). It CHECKS what it shows and exits 1 with the list if one fails:
// the default name (Vijaya) on Today, the menu, Help and the public site and never "Agent OWL" or a bare {assistant}; the name an owner saves in Settings > AI assistant on Today, in the menu, in Help and on the dock (four languages),
// and still the default on the public site and the legal pages; the Ask dock on the main screens (phone and laptop, light and dark: above the bottom bar, an answer opens above the line, room under the last row) and not on Today, Settings,
// a form, a single record or the live call. Settings and the assistant screens run with ASSISTANT_SCREENS=mock (fake data kept in a cookie: nothing is called, nothing is stored on a server).
//   node e2e/dn-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dn)
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
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dn"));
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


const FLAGS = { ASSISTANT_SCREENS: "mock" };
const LANGS = ["te", "hi", "kn"];
const app = (p) => `${WEB_URL}/app/tenants/${TENANT}${p}`;

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dn-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("dn-shots: building the web app (a minute or two)");
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
    const NAME = "Asha";
    const DOCK_SCREENS = ["/orders", "/quotes", "/outbox", "/visits"];
    const NO_DOCK = ["/", "/settings", "/settings?section=assistant", "/quotes/new", "/office/live", "/help"];
    const answerFor = (route) => route.fulfill({ status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" }, body: [{ type: "text", delta: "Two quotes wait for your OK and one customer asked for a call. " }, { type: "text", delta: "Nothing else needs you today." }, { type: "done" }].map((e) => JSON.stringify(e)).join("\n") + "\n" });
    const around = (text, re) => { const m = re.exec(text); return m ? `…${text.slice(Math.max(0, m.index - 50), m.index + 60).replaceAll("\n", " | ")}…` : ""; };
    const dockWords = async (page) => page.locator('[data-dock="ask"]').innerText().catch(() => "");

    await startWeb(FLAGS);

    // 1. the default name: Today, the menu, Help, the legal page and the public site say Vijaya; the dock is on the main screens and only there
    for (const scheme of ["light", "dark"]) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `${scheme}-${sizeName}-en`;
        {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.goto(app("/"), { waitUntil: "networkidle" });
          const text = await common(tag, "today", page, errors, sizeName);
          check(/\bVijaya\b/.test(text), `${tag} today: the default name Vijaya is not on Today`);
          check(!/Agent OWL/.test(text), `${tag} today: Agent OWL is on Today`);
          check((await page.locator('[data-dock]').count()) === 0, `${tag} today: the dock is drawn on Today (it has its own line)`);
          check((await page.locator('[data-ask="live"]').count()) === 1, `${tag} today: not one Ask line`);
          await save(page, "today-default-name", tag, "Today with the default name", { fullPage: false });
          await context.close();
        }
        for (const route of DOCK_SCREENS) {
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en" });
          await page.route("**/tenants/*/ask", answerFor);
          await page.goto(app(route), { waitUntil: "networkidle" });
          const label = `dock ${route}`;
          await page.locator('[data-dock="ask"] [data-ask="live"] form').waitFor({ timeout: 20000 });
          const text = await common(tag, label, page, errors, sizeName);
          check(!/Agent OWL/.test(text), `${tag} ${label}: Agent OWL is on the page`);
          const bar = await page.locator('[data-ask="live"] form').boundingBox();
          const view = page.viewportSize();
          const nav = sizeName === "phone" ? await page.locator('nav[aria-label]').last().boundingBox() : null;
          check(bar !== null && bar.y + bar.height > view.height - 140 && bar.y + bar.height <= view.height + 1, `${tag} ${label}: the line is not at the bottom (y ${bar && Math.round(bar.y)}, height ${view.height})`);
          if (nav && bar) check(bar.y + bar.height <= nav.y + 1, `${tag} ${label}: the line is under the bottom bar (${Math.round(bar.y + bar.height)} > ${Math.round(nav.y)})`);
          check((await page.locator('[data-ask-can]').count()) === 0, `${tag} ${label}: the "What can it do?" card is under the dock`);
          check((await page.locator('[data-dock="room"]').count()) === 1, `${tag} ${label}: no room under the last row`);
          if (route === "/quotes") await save(page, "dock-quotes", tag, "a main screen with the Ask dock at the bottom", { fullPage: false });
          // ask: the answer opens in a sheet above the line, never over the line
          await page.getByLabel(/^Your question for/).fill("What needs me today?");
          await page.keyboard.press("Enter");
          await page.getByText("Nothing else needs you today.").waitFor({ timeout: 15000 }).catch(async (e) => {
            await save(page, "debug-dock-answer", tag, "DEBUG");
            throw new Error(`${tag} ${label}: no answer in the dock. Dock text: ${(await dockWords(page)).replaceAll("\n", " | ").slice(0, 400)}; ${e.message.split("\n")[0]}`);
          });
          const sheet = await page.locator('[data-dock="ask"] [aria-live="polite"]').boundingBox();
          const line = await page.locator('[data-ask="live"] form').boundingBox();
          check(sheet !== null && line !== null && sheet.y + sheet.height <= line.y + 2, `${tag} ${label}: the answer is over the line`);
          check(sheet !== null && sheet.height <= view.height * 0.62, `${tag} ${label}: the answer sheet is taller than 60% of the screen`);
          check(sheet !== null && sheet.y >= 0, `${tag} ${label}: the answer starts above the top of the screen`);
          if (route === "/quotes") await save(page, "dock-quotes-answer", tag, "the dock with an answer open above the line", { fullPage: false });
          check(errors.length === 0, `${tag} ${label}: console errors ${errors.join(" | ")}`);
          await context.close();
        }
      }
    }
    for (const sizeName of Object.keys(SIZES)) {
      for (const route of NO_DOCK) {
        const tag = `light-${sizeName}-en`;
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        await page.goto(app(route), { waitUntil: "networkidle" });
        await page.waitForTimeout(1800); // longer than the dock needs to appear
        check((await page.locator('[data-dock]').count()) === 0, `${tag} ${route}: the dock is drawn here`);
        check(errors.filter((e) => !/404/.test(e)).length === 0, `${tag} ${route}: console errors ${errors.join(" | ")}`);
        await context.close();
      }
    }
    for (const [name, url, words] of [["help", "/help", ["Vijaya"]], ["settings-automation", "/settings?section=agent", ["Automation", "Vijaya"]]]) {
      const { context, page, errors } = await open({ scheme: "light", sizeName: "desktop", lang: "en" });
      await page.goto(app(url), { waitUntil: "networkidle" });
      const text = await common("light-desktop-en", name, page, errors, "desktop");
      has("light-desktop-en", name, text, words);
      check(!/Agent OWL/.test(text), `${name}: Agent OWL is on the page`);
      await save(page, name, "light-desktop-en", `${name} with the default name`);
      await context.close();
    }

    // 2. the owner gives the assistant a name in Settings > AI assistant: Today, the menu, Help, the dock and every language follow; the public site and the legal pages keep the default
    for (const sizeName of Object.keys(SIZES)) {
      const tag = `light-${sizeName}-en`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
      await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
      await page.getByLabel("Assistant name").fill(NAME);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Saved.").waitFor({ timeout: 15000 });
      await page.goto(app("/"), { waitUntil: "networkidle" });
      const today = await common(tag, "today (named)", page, errors, sizeName);
      check(today.includes(NAME), `${tag} named: Today does not say ${NAME}`);
      check(!/\bVijaya\b|Agent OWL/.test(today), `${tag} named: Vijaya or Agent OWL is still on Today ${around(today, /\bVijaya\b|Agent OWL/)}`);
      await save(page, "today-named", tag, `Today with the owner's name for the assistant (${NAME})`, { fullPage: false });
      await page.goto(app("/quotes"), { waitUntil: "networkidle" });
      await page.locator('[data-dock="ask"] [data-ask="live"] form').waitFor({ timeout: 20000 });
      const orders = await common(tag, "quotes (named)", page, errors, sizeName);
      check(!/\bVijaya\b|Agent OWL/.test(orders), `${tag} named: Vijaya or Agent OWL is on Quotes`);
      check((await page.getByLabel(`Your question for ${NAME}`).count()) === 1, `${tag} named: the dock's question line is not labelled with ${NAME}`);
      await save(page, "dock-named", tag, `the dock with the owner's name (${NAME}) for the assistant`, { fullPage: false });
      for (const url of ["/help", "/settings?section=agent", "/office"]) {
        await page.goto(app(url), { waitUntil: "networkidle" });
        const text = await page.locator("body").innerText();
        check(!/\bVijaya\b|Agent OWL|\{assistant\}/.test(text), `${tag} named: Vijaya, Agent OWL or {assistant} is on ${url}`);
      }
      // the public site and the legal pages are for strangers: the default name
      await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
      const home = await page.locator("body").innerText();
      check(/\bVijaya\b/.test(home) && !home.includes(NAME) && !/Agent OWL|\{assistant\}/.test(home), `${tag} public home: not the default name (${NAME}: ${home.includes(NAME)}, Vijaya: ${/\bVijaya\b/.test(home)})`);
      await page.goto(`${WEB_URL}/privacy`, { waitUntil: "networkidle" });
      const privacy = await page.locator("body").innerText();
      check(/\bVijaya\b/.test(privacy) && !privacy.includes(NAME) && !/Agent OWL|\{assistant\}/.test(privacy), `${tag} privacy: not the default name`);
      check(errors.filter((e) => !/404/.test(e)).length === 0, `${tag} named: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    for (const lang of LANGS) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `light-${sizeName}-${lang}`;
        const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang });
        await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
        await page.locator("#asst-name").fill(NAME);
        await page.locator('[data-settings="assistant"] button[type="submit"]').click();
        await page.locator('[data-settings="assistant"] [role="status"]').waitFor({ timeout: 15000 });
        await page.goto(app("/"), { waitUntil: "networkidle" });
        const text = await common(tag, "today (named)", page, errors, sizeName);
        check(script.test(text), `${tag} today: no ${lang} script`);
        check(!/\bVijaya\b|Agent OWL|\{assistant\}/.test(text), `${tag} today: Vijaya, Agent OWL or {assistant} is on the page ${around(text, /\bVijaya\b|Agent OWL|\{assistant\}/)}`);
        await save(page, "today-named", tag, `Today in ${lang} with the owner's name (draft words)`, { fullPage: false });
        await context.close();
      }
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`dn-shots: ${error.message}`);
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

