// Job DB: pictures AND checks of the legal and contact pages: /privacy (English and Telugu), /terms, /data-deletion, /contact, the footer of the public site, the sign-up and sign-in footers; light and dark, on a laptop
// (1280 x 900) and on a 390 px phone, from the real web app (a production build) on the visual tests' invented backend (the same start-up as e2e/cl-shots.mjs). Nothing is signed in: all of these are public pages.
//   node e2e/db-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-db)
// It also CHECKS what it shows and exits 1 with the list if one fails: no leftover {token} or [bracket], no phone number, the four addresses as selectable text with a working Copy button, privacy / terms / data-deletion
// linked from every footer and from the sign-up and sign-in pages, the canonical link and Open Graph address on https://stack19.com, no horizontal scroll at 390 px, no text under 14 px.
// Port 3016 (web) and 54999 (the stand-in): the same as `make perf` and e2e/cl-shots.mjs, so never run them at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-db"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
const ADDRESSES = ["hello@stack19.com", "support@stack19.com", "billing@stack19.com", "privacy@stack19.com"];

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
    for (const scheme of ["light", "dark"]) {
      for (const [sizeName, size] of Object.entries(SIZES)) {
        const tag = `${sizeName}/${scheme}`;
        const open = async (url, lang = "en") => {
          const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone", permissions: ["clipboard-read", "clipboard-write"] });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }]);
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
        /** The checks every page of this job must pass. */
        const common = async (s, label, { canonical, fontScope = "body" } = {}) => {
          check(s.status === 200, `${tag} ${label}: HTTP ${s.status}`);
          const text = await s.page.locator("body").innerText();
          check(!/\{[a-z_]+\}/.test(text), `${tag} ${label}: a {token} is left on the page`);
          check(!/\[(CONFIRM|LEGAL REVIEW|[A-Z ]{3,})\]/.test(text), `${tag} ${label}: a [bracketed] missing fact is on the page`);
          check(!/pending legal review|Draft, pending/i.test(text), `${tag} ${label}: a draft banner is on the page`);
          check(!/(\+91|\b0?[6-9]\d{9}\b)/.test(text.replace(/\s/g, "")), `${tag} ${label}: something that looks like a phone number is on the page`);
          check((await s.page.locator('a[href^="tel:"]').count()) === 0, `${tag} ${label}: a tel: link`);
          if (sizeName === "phone") check(await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways`);
          const small = await s.page.evaluate((scope) => {
            const n = [];
            for (const el of document.querySelectorAll(`${scope} *`)) {
              if (!el.childNodes.length || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
              const st = getComputedStyle(el);
              if (st.display === "none" || st.visibility === "hidden") continue;
              if (parseFloat(st.fontSize) < 14) n.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}" ${st.fontSize}`);
            }
            return n;
          }, fontScope);
          check(small.length === 0, `${tag} ${label}: text under 14 px: ${small.join("; ")}`);
          if (canonical) {
            check((await s.page.locator('link[rel="canonical"]').getAttribute("href")) === `https://stack19.com${canonical}`, `${tag} ${label}: the canonical link is not https://stack19.com${canonical}`);
            check((await s.page.locator('meta[property="og:url"]').getAttribute("content")) === `https://stack19.com${canonical}`, `${tag} ${label}: og:url is not https://stack19.com${canonical}`);
            check(/^https:\/\/stack19\.com\//.test((await s.page.locator('meta[property="og:image"]').getAttribute("content")) ?? ""), `${tag} ${label}: og:image is not on https://stack19.com`);
          }
          check(s.errors.length === 0, `${tag} ${label}: console errors: ${s.errors.join(" | ")}`);
        };
        const footerLinks = async (page, label, scope = "footer") => {
          const hrefs = await page.locator(`${scope} a`).evaluateAll((els) => els.map((e) => e.getAttribute("href")));
          for (const h of ["/privacy", "/terms", "/data-deletion"]) check(hrefs.includes(h), `${tag} ${label}: no ${h} link in the footer`);
        };

        // ---- the three legal pages in English, then the Privacy Policy in Telugu -------------------------------------------------------------------
        for (const [url, name, h1] of [["/privacy", "privacy", "Privacy Policy"], ["/terms", "terms", "Terms of Use"], ["/data-deletion", "data-deletion", "Delete your data"]]) {
          const s = await open(url);
          await common(s, name, { canonical: url });
          check((await s.page.locator("h1").count()) === 1 && (await s.page.locator("h1").innerText()) === h1, `${tag} ${name}: the h1 is not "${h1}"`);
          check(/Last updated: 24 October 2026/.test(await s.page.locator("body").innerText()), `${tag} ${name}: no last-updated date`);
          await footerLinks(s.page, name);
          await save(s.page, name, `${url} in English`, { fullPage: true });
          if (name === "privacy") {
            const text = await s.page.locator("body").innerText();
            for (const w of ["Mumbai", "Grievance Officer", "Gowtham Reddy Sodanapalli", "privacy@stack19.com", "within 30 days", "Schools and colleges"]) check(text.includes(w), `${tag} privacy: "${w}" is missing`);
          }
          await s.context.close();
        }
        for (const lang of ["te", "hi", "kn"]) {
          if (lang !== "te" && sizeName === "phone") continue; // Hindi and Kannada: on the laptop only; Telugu on both
          const s = await open("/privacy", lang);
          await common(s, `privacy (${lang})`, { canonical: "/privacy" });
          check((await s.page.locator('[data-legal="translated"]').count()) === 1, `${tag} privacy (${lang}): no machine-written note`);
          check((await s.page.locator("h1").getAttribute("lang")) === lang, `${tag} privacy (${lang}): the h1 is not in ${lang}`);
          await save(s.page, `privacy-${lang}`, `/privacy in ${lang}, with the machine-written note`, { fullPage: true });
          await s.context.close();
        }
        {
          const s = await open("/data-deletion", "te");
          await common(s, "data-deletion (te)", { canonical: "/data-deletion" });
          await save(s.page, "data-deletion-te", "/data-deletion in Telugu", { fullPage: true });
          await s.context.close();
        }

        // ---- contact: the four addresses as text, Copy works, mailto only as an extra --------------------------------------------------------------
        {
          const s = await open("/contact");
          await common(s, "contact");
          const shown = await s.page.locator('[data-part="addresses"] [data-part="address"]').allInnerTexts();
          check(JSON.stringify(shown) === JSON.stringify(ADDRESSES), `${tag} contact: the addresses on the page are ${JSON.stringify(shown)}`);
          check((await s.page.locator('[data-part="address"]').evaluateAll((els) => els.every((e) => e.tagName === "SPAN"))) === true, `${tag} contact: an address is not plain text`);
          check((await s.page.locator('a[href^="mailto:"]').count()) >= 4, `${tag} contact: no mailto: extra`);
          await footerLinks(s.page, "contact");
          for (const [i, address] of ADDRESSES.entries()) {
            await s.page.locator("[data-part=addresses] button").nth(i).click();
            const got = await s.page.evaluate(() => navigator.clipboard.readText()).catch(() => "(clipboard unreadable)");
            check(got === address, `${tag} contact: Copy ${i + 1} put "${got}" on the clipboard, not ${address}`);
          }
          await save(s.page, "contact", "/contact: four addresses, Copy button, mailto as an extra", { fullPage: true });
          await s.context.close();
        }
        {
          const s = await open("/contact", "hi");
          await common(s, "contact (hi)");
          await save(s.page, "contact-hi", "/contact in Hindi", { fullPage: true });
          await s.context.close();
        }

        // ---- the footers: public home, sign-up, sign-in --------------------------------------------------------------------------------------------
        {
          const s = await open("/");
          await common(s, "home", { fontScope: "footer" }); // the home page's own sample-chat label is 11 px by its design (not part of this job)
          await footerLinks(s.page, "home");
          check((await s.page.locator("footer").first().innerText()).includes("hello@stack19.com"), `${tag} home: the footer does not show hello@stack19.com`);
          await save(s.page.locator("footer").first(), "footer-home", "the public site's footer: contact address with Copy, privacy, terms, data deletion");
          await s.context.close();
        }
        for (const [url, name] of [["/signup", "signup"], ["/login", "login"]]) {
          const s = await open(url);
          await common(s, name);
          await footerLinks(s.page, name);
          if (name === "signup") {
            await s.page.locator("[data-pack-card]").first().click(); // step 2 carries the agreement line
            await s.page.getByText("Continue with e-mail").waitFor({ timeout: 30_000 });
            const hrefs = await s.page.locator("main a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
            check(hrefs.includes("/privacy") && hrefs.includes("/terms"), `${tag} signup: the agreement line does not link /privacy and /terms`);
          }
          await save(s.page, `footer-${name}`, `${url}: privacy, terms and data deletion in the footer`, { fullPage: true });
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
