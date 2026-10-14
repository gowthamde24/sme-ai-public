// Job CM: pictures of the public website (home, the three business types, pricing, how it works, security, contact, help), light and dark, on a laptop (1280 x 900) and on a 390 px phone, from the real web app (a
// production build) with NO backend at all (the public pages need none). OUR WhatsApp number is set to a made-up one so the contact form and the calculator's chat form are drawn.
//   node e2e/cm-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-cm)
// It also CHECKS what it shows (one h1, no sideways scroll, the calculator's numbers, the language switch, the phone's menu, the refusal of an unticked consent) and exits 1 with the list if one fails.
// Port 3016 (the same as `make perf` and e2e/cl-shots.mjs, so never run them at once); it stops only its own child, by its process id.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-cm"));
const WEB_PORT = 3016;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
const PAGES = [
  ["home", "/"],
  ["textiles", "/textiles"],
  ["construction", "/construction"],
  ["education", "/education"],
  ["pricing", "/pricing"],
  ["how-it-works", "/how-it-works"],
  ["security", "/security"],
  ["contact", "/contact"],
  ["help", "/help"],
];
const OTHER_LANGUAGES = [["te", ["home", "construction", "pricing"]], ["hi", ["home"]], ["kn", ["home"]]];

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
  if (await portBusy(WEB_PORT)) throw new Error(`port ${WEB_PORT} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:54999", NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: "https://127.0.0.1:54999" };
  if (!process.argv.includes("--no-build")) {
    console.log("shots: building the web app (a minute or two)");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", STACK19_WHATSAPP: "919876543210" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let webLog = "";
  web.stdout.on("data", (d) => (webLog += d));
  web.stderr.on("data", (d) => (webLog += d));
  const written = [];
  const problems = [];
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  try {
    await waitForPort(WEB_PORT);
    const browser = await chromium.launch();
    for (const scheme of ["light", "dark"]) {
      for (const [sizeName, size] of Object.entries(SIZES)) {
        const open = async (lang) => {
          const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
          page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
          return { context, page, errors };
        };
        const shoot = async (lang, name, address, note, after) => {
          const { context, page, errors } = await open(lang);
          const where = `${sizeName}/${scheme} ${lang} ${name}`;
          await page.goto(`${WEB_URL}${address}`, { waitUntil: "networkidle" });
          check((await page.locator("h1").count()) === 1, `${where}: not exactly one h1`);
          check((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${where}: the page scrolls sideways`);
          check((await page.locator('a[href="/signup"]').count()) >= 1, `${where}: no sign-up link`);
          if (after) await after(page, where);
          const file = path.join(OUT, `${lang}-${name}-${scheme}-${sizeName}.png`);
          await page.screenshot({ path: file, fullPage: true });
          written.push(`${path.basename(file)}  (${note})`);
          problems.push(...errors.map((e) => `${where}: console ${e}`));
          await context.close();
        };
        for (const [name, p] of PAGES) {
          await shoot("en", name, p, `${name}, English`, name === "construction" ? async (page, where) => {
            // the calculator: 1,000 sq ft of the first paver at 5% wastage is 4,725 blocks, 10 pallets, 2 trips (the quote engine's own golden numbers)
            const result = page.locator('[data-part="paver-result"]');
            await result.waitFor();
            check(/4,725/.test(await result.innerText()), `${where}: the calculator does not show 4,725 blocks for 1,000 sq ft`);
            await page.locator("#pc-area").fill("2500");
            check(/11,813|11,812/.test(await result.innerText()), `${where}: the calculator did not change with the area`);
            await page.locator("#pc-area").fill("1000");
          } : name === "contact" ? async (page, where) => {
            await page.getByRole("button", { name: /Continue on WhatsApp/ }).click();
            await page.locator('p[role="alert"]').waitFor({ timeout: 15_000 }).catch(() => null);
            check(await page.locator('p[role="alert"]').isVisible(), `${where}: an unticked consent was not refused`);
          } : undefined);
        }
        for (const [lang, names] of OTHER_LANGUAGES) for (const [name, p] of PAGES.filter(([n]) => names.includes(n))) await shoot(lang, name, `/${lang}${p === "/" ? "" : p}`, `${name}, ${lang}`);
        // the language switch goes to the same page in the other language, and the phone's menu opens
        {
          const { context, page, errors } = await open("en");
          await page.goto(`${WEB_URL}/pricing`, { waitUntil: "networkidle" });
          await page.locator("header select").selectOption("te");
          await page.waitForURL("**/te/pricing", { timeout: 15_000 }).catch(() => null);
          check(page.url().endsWith("/te/pricing"), `${sizeName}/${scheme}: the language switch did not go to /te/pricing (${page.url()})`);
          if (sizeName === "phone" || size.width < 1536) {
            await page.locator("header select").selectOption("en");
            await page.waitForURL("**/pricing", { timeout: 15_000 }).catch(() => null);
            await page.locator("summary").first().click();
            await page.locator("details nav a").first().waitFor();
            const file = path.join(OUT, `en-menu-open-${scheme}-${sizeName}.png`);
            await page.screenshot({ path: file });
            written.push(`${path.basename(file)}  (the menu open)`);
          }
          problems.push(...errors.map((e) => `${sizeName}/${scheme} switch: console ${e}`));
          await context.close();
        }
      }
    }
    await browser.close();
  } finally {
    try {
      web.kill("SIGTERM"); // our own child, by its own process id
    } catch {
      // already gone
    }
  }
  console.log(`shots: ${written.length} pictures in ${OUT}`);
  if (problems.length) {
    console.error(`shots: ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
    if (/error/i.test(webLog)) console.error(webLog.slice(-1500));
    process.exit(1);
  }
  console.log("shots: no problems");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
