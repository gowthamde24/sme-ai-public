// Job DH: /signup in its two states, in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). The web is started twice from the SAME build: with
// NEXT_PUBLIC_SIGNUP_OPEN unset (open: today's two steps) and with it "0" (closed: the friendly note and the early-access address). Also /login. 1280 and 390 px, light and dark; Telugu for the closed note.
//   node e2e/signup-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dh/signup)
// It CHECKS what it shows and exits 1 with the list if one fails: the closed page has the title, the address as plain selectable text, a Copy button that really copies it, a mailto link as an extra, a sign-in link, and NO form,
// no input, no business card, no Google or Facebook button; the open page has the three business cards and, on step 2, "Continue with e-mail" and the Terms and Privacy line; no horizontal scroll at 390 px; no console errors.
// Port 3016 (web) and 54999 (the stand-in), like e2e/cl-shots.mjs and e2e/db-shots.mjs: never run them at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, PACK_STATE } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dh", "signup"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };

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
  const tmp = mkdtempSync(path.join(os.tmpdir(), "signup-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("signup-shots: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  Object.assign(PACK_STATE, { providers: { google: true, facebook: true } });
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem") });
  const written = [];
  const problems = [];
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  let web = null;
  const startWeb = async (open) => {
    const env = { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW };
    if (open) delete env.NEXT_PUBLIC_SIGNUP_OPEN;
    else env.NEXT_PUBLIC_SIGNUP_OPEN = "0";
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
  try {
    browser = await chromium.launch();
    for (const open of [false, true]) {
      await startWeb(open);
      const state = open ? "open" : "closed";
      for (const scheme of ["light", "dark"]) {
        for (const [sizeName, size] of Object.entries(SIZES)) {
          for (const lang of open ? ["en"] : ["en", "te"]) {
            if (lang === "te" && scheme === "dark") continue;
            const tag = `${state}-${lang}-${scheme}-${sizeName}`;
            const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone", permissions: ["clipboard-read", "clipboard-write"] });
            await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }]);
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
            page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
            const save = async (name, note, opts = {}) => {
              const file = path.join(OUT, `${name}-${tag}.png`);
              await page.screenshot({ path: file, ...opts });
              written.push(`${path.basename(file)}  (${note})`);
            };
            const common = async (label) => {
              if (sizeName === "phone") check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways at 390 px`);
              check(errors.length === 0, `${tag} ${label}: console errors: ${errors.join(" | ")}`);
              check(!/\{[a-z_]+\}/.test(await page.locator("body").innerText()), `${tag} ${label}: a {token} is on the page`);
            };
            await page.goto(`${WEB_URL}/signup`, { waitUntil: "networkidle" });
            if (!open) {
              const h1 = await page.locator("h1").innerText();
              check(lang === "en" ? h1 === "We are opening to businesses soon" : /[ఀ-౿]/.test(h1), `${tag}: the closed title is "${h1}"`);
              check((await page.locator("form").count()) === 0 && (await page.locator("input:visible").count()) === 0, `${tag}: a form or an input is on the closed page`);
              check((await page.locator("[data-pack-card]").count()) === 0, `${tag}: business cards are on the closed page`);
              check(!/Continue with|Google|Facebook/.test(await page.locator("main").innerText()), `${tag}: a sign-up button is on the closed page`);
              const address = page.locator('[data-part="address"]');
              check((await address.innerText()) === "hello@stack19.com" && (await address.evaluate((e) => e.tagName)) === "SPAN", `${tag}: the early-access address is not plain text hello@stack19.com`);
              check((await page.locator('main a[href="mailto:hello@stack19.com"]').count()) === 1, `${tag}: no mailto: extra`);
              check((await page.locator('main a[href="/login"]').count()) === 1, `${tag}: no sign-in link`);
              await page.locator("main button").first().click();
              const got = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "(unreadable)");
              check(got === "hello@stack19.com", `${tag}: Copy put "${got}" on the clipboard`);
              await common("/signup");
              await save("signup", `/signup, closed (${lang}): the note, the early-access address with Copy, the way to sign in`, { fullPage: true });
              // the landing page's "Start your trial" links lead here: the same closed note, whatever business type is in the address
              await page.goto(`${WEB_URL}/signup?type=textiles`, { waitUntil: "networkidle" });
              check((await page.locator("h1").innerText()) === (lang === "en" ? "We are opening to businesses soon" : await page.locator("h1").innerText()), `${tag}: /signup?type=textiles is not the closed note`);
            } else {
              check((await page.locator("[data-pack-card]").count()) === 3, `${tag}: step 1 does not show three business cards`);
              check(!/opening to businesses soon/.test(await page.locator("body").innerText()), `${tag}: the closed note is on the open page`);
              await common("/signup (step 1)");
              await save("signup-1", "/signup, open: step 1, the three business cards", { fullPage: true });
              await page.locator("[data-pack-card]").first().click();
              await page.getByText("Continue with e-mail").waitFor({ timeout: 20000 });
              const t2 = await page.locator("main").innerText();
              check(/Continue with Google/.test(t2) && /Continue with Facebook/.test(t2), `${tag}: step 2 lacks the provider buttons the stand-in switches on`);
              check(/Terms/.test(t2) && /Privacy Policy/.test(t2), `${tag}: step 2 lacks the Terms and Privacy line`);
              await common("/signup (step 2)");
              await save("signup-2", "/signup, open: step 2, sign-in ways and the Terms line", { fullPage: true });
            }
            await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle" });
            check((await page.locator('input[name="email"]').count()) === 1, `${tag}: /login has no e-mail field`);
            check((await page.locator('a[href="/privacy"], a[href="/terms"]').count()) >= 2, `${tag}: /login lacks the privacy and terms links`);
            await common("/login");
            if (lang === "en") await save("login", "/login", { fullPage: true });
            await context.close();
          }
        }
      }
      await stopWeb();
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`signup-shots: ${error.message}`);
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
