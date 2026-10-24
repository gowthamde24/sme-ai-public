// Job DD: a short browser run of the response times and the product name, on a production build against the visual tests' invented backend (the same start-up as e2e/db-shots.mjs):
//   - /privacy and /data-deletion in English, Telugu, Hindi and Kannada say 7 days (access, correct, erase) and 30 days (any other grievance), and the contact page says both;
//   - three signed-in app pages (the workspace home, Settings, the Office) have titles like "Settings · Stack19", and no page of the run says "SME AI Revenue Engine".
// 1280 x 900 and 390 px, light and dark; pictures in DIR (default ~/Desktop/v2-overnight/shots-dd). Exit 1 with the list if a check fails. Port 3016 (web) and 54999 (the stand-in), like e2e/cl-shots.mjs: never run them at once.
//   node e2e/dd-shots.mjs [--no-build] [--out DIR]
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
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dd"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
const TODAY = `/app/tenants/${TENANT}`;
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

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "db-shots-"));
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
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  try {
    await waitForPort(WEB_PORT);
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const scheme of ["light", "dark"]) {
      for (const [sizeName, size] of Object.entries(SIZES)) {
        const tag = `${sizeName}/${scheme}`;
        const open = async (url, { lang = "en", signedIn = false } = {}) => {
          const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, ...(signedIn ? [{ name: "sb-127-auth-token", value: cookie, url: WEB_URL }] : [])]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
          page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
          const res = await page.goto(`${WEB_URL}${url}`, { waitUntil: "networkidle" });
          return { context, page, errors, status: res?.status() };
        };
        const save = async (target, name, note, opts = {}) => {
          const file = path.join(OUT, `${name}-${scheme}-${sizeName}.png`);
          await target.screenshot({ path: file, ...opts });
          written.push(`${path.basename(file)}  (${note})`);
        };
        const basics = async (s, label) => {
          check(s.status === 200, `${tag} ${label}: HTTP ${s.status}`);
          const text = await s.page.locator("body").innerText();
          check(!/\{[a-z_]+\}/.test(text), `${tag} ${label}: a {token} is left on the page`);
          check(!/Revenue Engine/i.test(text) && !/Revenue Engine/i.test(await s.page.title()), `${tag} ${label}: the old product name is on the page`);
          if (sizeName === "phone") check(await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways`);
          check(s.errors.length === 0, `${tag} ${label}: console errors: ${s.errors.join(" | ")}`);
          return text;
        };
        // the response times, in the four languages: 7 for a request to access, correct or erase; 30 for any other grievance. English words, then the numbers next to the day word of each language.
        const DAY = { te: "రోజుల", hi: "दिन", kn: "ದಿನಗಳ" };
        for (const url of ["/privacy", "/data-deletion"]) {
          const s = await open(url);
          const text = await basics(s, url);
          if (url === "/privacy") {
            for (const w of ["within 7 days", "within 30 days"]) check(text.includes(w), `${tag} ${url} (en): "${w}" is missing`);
            check(/access, correct or erase your data within 7 days, and any other request or complaint within 30 days/.test(text), `${tag} ${url} (en): the rights paragraph does not give both times`);
          } else {
            check(/delete your data within 7 days\. Any other complaint about your data is answered within 30 days/.test(text), `${tag} ${url} (en): the page does not give both times`);
          }
          await save(s.page, url.slice(1), `${url} in English: 7 and 30 days`, { fullPage: true });
          await s.context.close();
          for (const lang of ["te", "hi", "kn"]) {
            const t = await open(url, { lang });
            const tt = await basics(t, `${url} (${lang})`);
            check(new RegExp(`(?<![\\d,])7\\s*${DAY[lang]}`).test(tt) && new RegExp(`(?<![\\d,])30\\s*${DAY[lang]}`).test(tt), `${tag} ${url} (${lang}): 7 and 30 with the word for days are not both on the page`);
            check((await t.page.locator('[data-legal="translated"]').count()) === 1, `${tag} ${url} (${lang}): the machine-written note is missing`);
            if (sizeName === "desktop" || lang === "te") await save(t.page, `${url.slice(1)}-${lang}`, `${url} in ${lang}: 7 and 30 days`, { fullPage: true });
            await t.context.close();
          }
        }
        {
          const s = await open("/contact");
          const text = await basics(s, "/contact");
          check(/within 7 days\. Other complaints: within 30 days/.test(text), `${tag} /contact: the response times are missing`);
          await save(s.page, "contact", "/contact: the response times under the privacy address", { fullPage: true });
          await s.context.close();
        }

        // three app pages (signed in): the titles carry the product name from the brand file
        for (const [url, title, name] of [[TODAY, "Workspace · Stack19", "workspace"], [`${TODAY}/settings`, "Settings · Stack19", "settings"], [`${TODAY}/office`, "Office · Stack19", "office"]]) {
          const s = await open(url, { signedIn: true });
          await basics(s, name);
          check((await s.page.title()) === title, `${tag} ${name}: the title is "${await s.page.title()}", not "${title}"`);
          await save(s.page, `app-${name}`, `${name}: title "${title}"`);
          await s.context.close();
        }
        for (const [url, title] of [["/login", "Sign in · Stack19"], ["/signup", "Create your account · Stack19"]]) {
          const s = await open(url);
          await basics(s, url);
          check((await s.page.title()) === title, `${tag} ${url}: the title is "${await s.page.title()}", not "${title}"`);
          await s.context.close();
        }
      }
    }
    await browser.close();
  } catch (error) {
    problems.push(error.message);
    console.error(`shots: ${error.message}\n--- web log (tail) ---\n${webLog.slice(-1500)}`);
    process.exitCode = 1;
  } finally {
    await stop();
  }
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n${problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : ""}`);
  console.log(`${written.length} pictures in ${OUT}${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();
