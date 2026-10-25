// Job DK: the Plan and usage screens in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). The web is started twice from ONE build: with PLAN_SCREENS unset
// (the flag OFF: Settings has no Plan part, /plans is a 404) and with PLAN_SCREENS=mock (the fake provider: its whole state is one cookie, so each scenario is drawn by setting that cookie). 1280 and 390 px, light and dark;
// Telugu, Hindi and Kannada for one scenario; then one WALK with real clicks: start the trial (refused without a payment method), jump to day 30 with a card that fails, update the payment, cancel.
//   node e2e/plan-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dk)
// It CHECKS what it shows and exits 1 with the list if one fails: the expected words of each scenario, never a rupee sign, a price or the word "token", no {placeholder}, no sideways scroll at 390 px, no console error.
// Port 3016 (web) and 54999 (the stand-in), like the other shots scripts: never run them at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dk"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
const MOCK_COOKIE = "sme_plan_mock";

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

// state;plan;method;day;minutes;messages;cancelled  (lib/plan/mock.ts; the plan ids are those of packages/plans/plans.json)
const SCENARIOS = [
  { id: "none", cookie: null, has: ["No plan yet", "Start 30-day trial", "0 of 30", "0 of 100"], hasNot: [] },
  { id: "trial-day1", cookie: "trialing;growth;test_ok;1;0;0;0", has: ["Plan: Growth", "Day 1 of 30 of your trial", "30 days left", "Price coming soon", "0 of 30", "0 of 100", "Cancel trial", "Change plan"], hasNot: ["Calls and announcements are paused", "You have used"] },
  { id: "trial-80", cookie: "trialing;growth;test_ok;12;4;80;0", has: ["Day 12 of 30 of your trial", "19 days left", "80 of 100", "You have used 80% of your WhatsApp messages."], hasNot: ["Calls and announcements are paused"] },
  { id: "trial-100", cookie: "trialing;growth;test_ok;20;30;100;0", has: ["Calls and announcements are paused", "Quotes, orders, follow-ups and your customers keep working as usual"], hasNot: ["You have used 80%"] },
  { id: "trial-last-day", cookie: "trialing;growth;test_ok;30;10;20;0", has: ["1 day left"], hasNot: ["1 days left"] },
  { id: "active", cookie: "active;business;test_ok;5;120;900;0", has: ["Plan: Business", "Active", "120 of 300", "900 of 3,000"], hasNot: ["days left"] },
  { id: "starter-no-minutes", cookie: "active;starter;test_ok;3;0;120;0", has: ["Plan: Starter", "Not included in this plan.", "120 of 300"], hasNot: [] },
  { id: "payg", cookie: "active;calls_payg;test_ok;3;42;0;0", has: ["Plan: Pay-as-you-go", "42 used. You pay for what you use.", "0 used. You pay for what you use."], hasNot: ["Not included in this plan."] },
  { id: "calls-300-messages", cookie: "active;calls_300;test_ok;3;120;240;0", has: ["Plan: Calls 300", "120 of 300", "240 of 300", "You have used 80% of your WhatsApp messages."], hasNot: ["Not included in this plan."] },
  { id: "read-only", cookie: "cancelled;growth;test_ok;30;0;0;0;1", has: ["Read only", "Your workspace is read-only", "look at everything and export it", "Your data is kept until", "To go on, write to billing@stack19.com."], hasNot: ["Cancel trial", "Change plan", "Choose a plan", "Start 30-day trial", "Your plan was cancelled."] },
  { id: "past-due", cookie: "past_due;growth;test_fails;30;0;0;0", has: ["Payment failed", "Your last payment did not go through", "Update payment method"], hasNot: [] },
  { id: "active-cancelled", cookie: "active;growth;test_ok;5;10;20;1", has: ["Plan: Growth", "It will not renew."], hasNot: ["Cancel plan"] },
  { id: "cancelled-in-trial", cookie: "cancelled;growth;test_ok;6;0;0;1", has: ["Your trial was cancelled. Nothing was charged.", "Choose a plan"], hasNot: ["Cancel trial", "Start 30-day trial"] },
];
const LANG_SCENARIO = SCENARIOS.find((s) => s.id === "trial-80");

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "plan-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("plan-shots: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem") });
  const written = [];
  const problems = [];
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  let web = null;
  const startWeb = async (flag) => {
    const env = { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW };
    delete env.PLAN_SCREENS;
    if (flag) env.PLAN_SCREENS = flag;
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
  const open = async ({ scheme, sizeName, lang, cookie }) => {
    const size = SIZES[sizeName];
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
    const cookies = [{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: session, url: WEB_URL }];
    if (cookie) cookies.push({ name: MOCK_COOKIE, value: encodeURIComponent(cookie), url: WEB_URL }); // the app reads cookies decoded, like a browser that was given the cookie by its own server action
    await context.addCookies(cookies);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
    return { context, page, errors };
  };
  const common = async (tag, label, page, errors, sizeName) => {
    const text = await page.locator("main").innerText();
    if (sizeName === "phone") check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways at 390 px`);
    check(errors.length === 0, `${tag} ${label}: console errors: ${errors.join(" | ")}`);
    check(!/\{[a-z_]+\}/.test(text), `${tag} ${label}: a {token} is on the page`);
    check(!/₹|\brupees?\b|\btokens?\b|\bRs\.?\s?\d/i.test(text), `${tag} ${label}: money or tokens are on the page`);
    return text;
  };
  const save = async (page, name, tag, note, opts = {}) => {
    const file = path.join(OUT, `${name}-${tag}.png`);
    await page.screenshot({ path: file, fullPage: true, ...opts });
    written.push(`${path.basename(file)}  (${note})`);
  };
  const settingsUrl = `${WEB_URL}/app/tenants/${TENANT}/settings?section=plan`;
  try {
    browser = await chromium.launch();
    // 1. the flag OFF: no Plan part, /plans is a 404
    await startWeb(null);
    {
      const { context, page, errors } = await open({ scheme: "light", sizeName: "desktop", lang: "en", cookie: "trialing;growth;test_ok;12;4;80;0" });
      const res = await page.goto(settingsUrl, { waitUntil: "networkidle" });
      check(res.status() === 200, `off: settings answered ${res.status()}`);
      const tabs = await page.locator('nav[aria-label="Parts of Settings"]').innerText();
      check(!/\bPlan\b/.test(tabs.replace("Business and plan", "")), `off: the Plan tab is there: ${tabs.replaceAll("\n", " | ")}`);
      check((await page.locator('[data-settings="plan"]').count()) === 0, "off: ?section=plan drew the Plan part");
      await save(page, "flag-off-settings", "light-desktop", "the flag OFF: Settings has no Plan tab, and ?section=plan shows the business part");
      const gone = await page.goto(`${WEB_URL}/app/tenants/${TENANT}/plans`, { waitUntil: "networkidle" });
      // the workspace shows its loading shell first, so the status line can be 200 even for a page that is not found (as for any other missing page): what matters is what the person sees
      check(/We could not find that page/.test(await page.locator("body").innerText()), `off: /plans did not say "not found" (status ${gone.status()})`);
      await save(page, "flag-off-plans", "light-desktop", "the flag OFF: /plans is a 404");
      check(errors.filter((e) => !/404/.test(e)).length === 0, `off: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    await stopWeb();

    // 2. the fake provider: every scenario, both sizes, both themes
    await startWeb("mock");
    for (const scheme of ["light", "dark"]) {
      for (const sizeName of Object.keys(SIZES)) {
        for (const sc of SCENARIOS) {
          const tag = `${scheme}-${sizeName}`;
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en", cookie: sc.cookie });
          await page.goto(settingsUrl, { waitUntil: "networkidle" });
          const text = await common(tag, sc.id, page, errors, sizeName);
          for (const w of sc.has) check(text.includes(w), `${tag} ${sc.id}: "${w}" is missing`);
          for (const w of sc.hasNot) check(!text.includes(w), `${tag} ${sc.id}: "${w}" should not be there`);
          check(text.includes("Test mode: no real payment is taken and no card details are asked for."), `${tag} ${sc.id}: the test-mode label is missing`);
          check(text.includes("When everything is used up"), `${tag} ${sc.id}: the explainer of what happens at the limit is missing`);
          await save(page, `plan-${sc.id}`, tag, `Settings > Plan (${sc.id})`);
          await context.close();
        }
        // the picker, without a plan and with one
        for (const [id, cookie] of [["picker-new", null], ["picker-has-plan", "active;growth;test_ok;5;10;20;0"]]) {
          const tag = `${scheme}-${sizeName}`;
          const { context, page, errors } = await open({ scheme, sizeName, lang: "en", cookie });
          await page.goto(`${WEB_URL}/app/tenants/${TENANT}/plans`, { waitUntil: "networkidle" });
          const text = await common(tag, id, page, errors, sizeName);
          for (const n of ["Starter", "Growth", "Business", "Pay-as-you-go", "Calls 300", "Calls 1,000"]) check(text.includes(n), `${tag} ${id}: plan ${n} is missing`);
          check((text.match(/Price coming soon/g) ?? []).length === 6, `${tag} ${id}: not six "Price coming soon"`);
          check(id === "picker-new" ? (await page.locator('input[type="radio"]').count()) === 9 : (await page.locator('input[type="radio"]').count()) === 0, `${tag} ${id}: the start form is ${id === "picker-new" ? "missing" : "there although a plan exists"}`);
          await save(page, id, tag, id === "picker-new" ? "the six plans and the start form" : "the six plans, the business's own plan marked, no start form");
          await context.close();
        }
      }
    }

    // 3. the other languages: one scenario, light, both sizes, and the picker
    for (const lang of ["te", "hi", "kn"]) {
      for (const sizeName of Object.keys(SIZES)) {
        const tag = `${lang}-light-${sizeName}`;
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang, cookie: LANG_SCENARIO.cookie });
        await page.goto(settingsUrl, { waitUntil: "networkidle" });
        const text = await common(tag, "plan", page, errors, sizeName);
        const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
        check(script.test(text), `${tag}: no ${lang} script on the Plan part`);
        check(!/Plan: Growth|Test mode:/.test(text), `${tag}: English is on the Plan part`);
        check(text.includes("Growth"), `${tag}: the plan name (kept as a name) is missing`);
        await save(page, "plan-trial-80", tag, `Settings > Plan in ${lang}`);
        await page.goto(`${WEB_URL}/app/tenants/${TENANT}/plans`, { waitUntil: "networkidle" });
        await common(tag, "picker", page, errors, sizeName);
        await save(page, "picker-new", tag, `the plan picker in ${lang}`);
        await context.close();
      }
    }

    // 4. the walk, with real clicks (English, light, desktop and phone)
    for (const sizeName of Object.keys(SIZES)) {
      const tag = `light-${sizeName}`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en", cookie: null });
      await page.goto(`${WEB_URL}/app/tenants/${TENANT}/plans`, { waitUntil: "networkidle" });
      await page.getByRole("radio", { name: "Start the 30-day trial of Growth" }).check();
      await page.getByRole("button", { name: "Start the 30-day trial of Growth" }).click();
      await page.getByText("Choose a payment method to start the trial.").waitFor({ timeout: 15000 });
      await save(page, "walk-1-needs-method", tag, "walk: starting without a payment method is refused in words");
      await page.getByRole("radio", { name: "Test card that fails on renewal" }).check();
      await page.getByRole("button", { name: "Start the 30-day trial of Growth" }).click();
      await page.getByText(/Your 30-day trial of Growth has started/).waitFor({ timeout: 15000 });
      await save(page, "walk-2-started", tag, "walk: the trial has started");
      await page.goto(settingsUrl, { waitUntil: "networkidle" });
      check((await page.locator("main").innerText()).includes("30 days left"), `${tag} walk: not 30 days left after starting`);
      await save(page, "walk-3-trial", tag, "walk: Settings > Plan on day 1");
      await page.getByRole("button", { name: "Test only: jump to day 30" }).click();
      await page.getByText("Your last payment did not go through").waitFor({ timeout: 15000 });
      await save(page, "walk-4-past-due", tag, "walk: day 30 with a card that fails: the failed-payment state");
      await page.getByRole("button", { name: "Update payment method" }).click();
      await page.getByText("Active", { exact: true }).waitFor({ timeout: 15000 });
      await save(page, "walk-5-active", tag, "walk: payment updated, the plan is active");
      await page.getByRole("button", { name: "Cancel plan" }).click();
      await save(page, "walk-6-cancel-ask", tag, "walk: cancelling asks once");
      await page.getByRole("button", { name: "Yes, cancel" }).click();
      await page.getByText(/Your plan ends on .* It will not renew\./).waitFor({ timeout: 15000 });
      await save(page, "walk-7-cancelled", tag, "walk: a paid plan cancelled runs to the end of its period");
      await common(tag, "walk", page, errors, sizeName);
      await context.close();
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`plan-shots: ${error.message}`);
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
