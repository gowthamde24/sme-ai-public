// Job CL: pictures of the three business types (textiles, construction materials, education) in the pack-aware shell: the two sign-up steps, Today with its checklist and example-data banner, the phone's bottom bar and its
// More sheet, the menu, Customers (with the extra fields), Settings → Fields, the Start page, Fees and Campaigns, the Office, and the 403 page of a part a business type does not have; light and dark, on a laptop
// (1280 x 900) and on a 390 px phone, from the real web app (a production build) on the visual tests' invented backend. The stand-in serves the business type the script sets (fixtures.mjs PACK_STATE).
//   node e2e/cl-shots.mjs [--no-build] [--only signup,today,...] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-cl)
// It also CHECKS what it shows (a menu item that must be there or not, a 403 for a typed address and for a move inside the app) and exits 1 with the list if one fails.
// Port 3016 (web) and 54999 (the stand-in): the same as `make perf` and e2e/cj-shots.mjs, so never run them at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, PACK_STATE, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ONLY = arg("only", "").split(",").filter(Boolean);
const want = (name) => ONLY.length === 0 || ONLY.includes(name);
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-cl"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const TODAY = `${WEB_URL}/app/tenants/${TENANT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
// what each business type is set to look like (the stand-in answers `GET .../pack` with it)
const PACKS = {
  textiles: { example: "none", town: null },
  construction: { example: "available", town: "Guntur" },
  education: { example: "loaded", town: null },
};
// the menu each business type must show (owner), by the words on the menu
const MENU = {
  textiles: { has: ["Leads", "Quotes", "Store visits", "Orders", "Customer chats", "Customers", "Find retailers", "Catalogue", "Prices and products"], not: ["Fees", "Campaigns"], bar: ["Today", "Leads", "Quotes", "Visits", "Office"] },
  construction: { has: ["Quotes", "Site visits", "Orders & deliveries", "Campaigns", "Customers & sites", "Products", "Find contractors"], not: ["Fees", "Customer chats", "Store visits", "Orders", "Catalogue", "Find retailers"], bar: ["Today", "Inbox", "Orders & deliveries", "Customers"] },
  education: { has: ["Enquiries", "Fees", "Campaigns", "Campus visits", "Parents & students", "Inbox"], not: ["Quotes", "Orders", "Catalogue", "Products", "Find retailers", "Find contractors", "Prices and products"], bar: ["Today", "Inbox", "Fees", "Parents"] },
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cl-shots-"));
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
        const viewport = { width: size.width, height: size.height };
        const newPage = async ({ signedIn = true, lang = "en" } = {}) => {
          const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, ...(signedIn ? [{ name: "sb-127-auth-token", value: cookie, url: WEB_URL }] : [])]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
          page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
          return { context, page, errors };
        };
        const save = async (target, name, note, opts = {}) => {
          const file = path.join(OUT, `${name}-${scheme}-${sizeName}.png`);
          await target.screenshot({ path: file, ...opts });
          written.push(`${path.basename(file)}  (${note})`);
        };

        // ---- sign-up: step 1 (the same for everyone) in English and Telugu, then step 2 for each business type -------------------------------------
        if (want("signup")) {
          for (const lang of ["en", "te"]) {
            const s = await newPage({ signedIn: false, lang });
            await s.page.goto(`${WEB_URL}/signup`, { waitUntil: "networkidle" });
            await s.page.locator("[data-pack-card]").first().waitFor({ timeout: 30_000 });
            check((await s.page.locator("[data-pack-card]").count()) === 3, `${sizeName}/${scheme} sign-up step 1 (${lang}): not three cards`);
            check((await s.page.locator("input:visible").count()) === 0, `${sizeName}/${scheme} sign-up step 1 (${lang}): there is something to fill in`);
            await save(s.page, `signup-1-${lang}`, `sign-up step 1: what kind of business do you run? (${lang})`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${sizeName}/${scheme} sign-up 1: ${e}`));
            await s.context.close();
          }
          for (const id of Object.keys(PACKS)) {
            const s = await newPage({ signedIn: false });
            await s.page.goto(`${WEB_URL}/signup?type=${id}`, { waitUntil: "networkidle" });
            await s.page.getByRole("button", { name: "Continue with Google" }).waitFor({ timeout: 30_000 });
            check(await s.page.getByRole("button", { name: "Continue with Facebook" }).isVisible(), `${id} sign-up step 2: no Facebook button`);
            check(await s.page.getByText("By continuing you agree to the").isVisible(), `${id} sign-up step 2: no terms line`);
            check((await s.page.locator('input[type="checkbox"]').count()) === 0, `${id} sign-up step 2: a tick box is there`);
            await save(s.page, `signup-2-${id}`, `sign-up step 2 for ${id}: Google, Facebook, e-mail and the terms line`, { fullPage: true });
            await s.page.locator("details[data-signup=email] summary").click();
            await s.page.getByLabel("Email").waitFor();
            check((await s.page.locator("details[data-signup=email] input:visible").count()) === 2, `${id} sign-up step 2: the e-mail way asks more than an address and a password`);
            await save(s.page, `signup-2-${id}-email`, `sign-up step 2 for ${id}, the e-mail way open`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${sizeName}/${scheme} sign-up 2 ${id}: ${e}`));
            await s.context.close();
          }
        }

        // ---- the app, for each business type ----------------------------------------------------------------------------------------------------
        for (const [id, state] of Object.entries(PACKS)) {
          Object.assign(PACK_STATE, { pack: id, example: state.example, town: state.town });
          const label = `${sizeName}/${scheme} ${id}`;
          const menuNames = async (page) => (sizeName === "phone" ? [] : page.locator('nav[aria-label="Workspace menu"] a').allTextContents());

          if (want("today")) {
            const s = await newPage();
            await s.page.goto(TODAY, { waitUntil: "networkidle" });
            await s.page.locator('[data-screen="today"]').waitFor({ timeout: 30_000 });
            await sleep(900);
            if (sizeName === "desktop") {
              const names = (await menuNames(s.page)).map((x) => x.replace(/\s*Waiting for you:.*$/, "").trim());
              for (const w of MENU[id].has) check(names.includes(w), `${label}: the menu has no "${w}" (${names.join(" | ")})`);
              for (const w of MENU[id].not) check(!names.includes(w), `${label}: the menu has "${w}" (${names.join(" | ")})`);
              check((await s.page.locator("[data-pack]").count()) === (id === "textiles" ? 0 : 1), `${label}: the business-type badge is ${id === "textiles" ? "there" : "missing"}`);
            } else {
              const tabs = (await s.page.locator('nav[aria-label="Quick menu"] > a, nav[aria-label="Quick menu"] > button').allTextContents()).map((x) => x.replace(/\d+$/, "").replace(/Waiting for you:\s*$/, "").trim());
              const want4 = [...MENU[id].bar, "More"];
              check(JSON.stringify(tabs.map((t) => t.replace(/Waiting for you:\s*\d*/, "").trim())) === JSON.stringify(want4), `${label}: the phone tabs are ${JSON.stringify(tabs)}, wanted ${JSON.stringify(want4)}`);
            }
            check(id === "textiles" ? (await s.page.locator('[data-start="card"], [data-example]').count()) === 0 : true, `${label}: textiles Today shows the start card or the example banner`);
            check(id === "construction" ? (await s.page.locator('[data-start="card"]').count()) === 1 && (await s.page.locator("[data-example=available]").count()) === 1 : true, `${label}: the checklist or the example banner is missing`);
            check(id === "education" ? (await s.page.locator("[data-example=loaded]").count()) === 1 : true, `${label}: the 'example data loaded' banner is missing`);
            await save(s.page, `today-${id}`, `Today for ${id}, whole page${sizeName === "phone" ? " (the bottom bar sits at the end of the capture)" : ""}`, { fullPage: true });
            if (sizeName === "phone") {
              await save(s.page, `today-${id}-fold`, `Today for ${id}, the first screen with the phone's bottom bar`);
              await s.page.getByRole("button", { name: "More" }).click();
              await s.page.getByRole("dialog").waitFor();
              await sleep(300);
              await save(s.page, `menu-more-${id}`, `the More sheet for ${id}`);
            }
            problems.push(...s.errors.map((e) => `${label} today: ${e}`));
            await s.context.close();
          }

          if (want("customers")) {
            const s = await newPage();
            await s.page.goto(`${TODAY}/customers/new`, { waitUntil: "networkidle" });
            await s.page.locator("form[aria-label]").first().waitFor({ timeout: 30_000 });
            const fields = await s.page.locator("[data-part=custom-fields]").count();
            check(fields === (id === "textiles" ? 0 : 1), `${label}: the extra fields on the customer form are ${fields ? "there" : "missing"}`);
            await save(s.page, `customer-form-${id}`, `Add a customer for ${id}${fields ? ", with the extra fields" : ""}`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${label} customer form: ${e}`));
            await s.context.close();
          }

          if (want("settings") && id !== "textiles") {
            const s = await newPage();
            await s.page.goto(`${TODAY}/settings?section=fields`, { waitUntil: "networkidle" });
            await s.page.locator("[data-part=fields]").waitFor({ timeout: 30_000 });
            await save(s.page, `settings-fields-${id}`, `Settings → Fields for ${id}`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${label} settings fields: ${e}`));
            await s.context.close();
          }

          if (want("start") && id !== "textiles") {
            const s = await newPage();
            await s.page.goto(`${TODAY}/start`, { waitUntil: "networkidle" });
            await s.page.getByRole("button", { name: "Save" }).waitFor({ timeout: 30_000 });
            await save(s.page, `start-${id}`, `the Start page for ${id}: the business name and city question and the checklist`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${label} start: ${e}`));
            await s.context.close();
          }

          if (want("soon")) {
            for (const which of ["fees", "campaigns"]) {
              const s = await newPage();
              const response = await s.page.goto(`${TODAY}/${which}`, { waitUntil: "networkidle" });
              const on = (id === "education") || (id === "construction" && which === "campaigns");
              void response; // the HTTP status stays 200 behind the workspace's streaming loading boundary (like every notFound() of the app); the 403 PAGE is what is checked
              check((await s.page.locator('[data-problem="403"]').count()) === (on ? 0 : 1), `${label}: /${which} ${on ? "answered the 403 page" : "did not answer the 403 page"}`);
              if (on) await save(s.page, `${which}-${id}`, `${which} for ${id}: a part that is on and not built yet says so`, { fullPage: true });
              problems.push(...s.errors.map((e) => `${label} ${which}: ${e}`));
              await s.context.close();
            }
          }

          if (want("office")) {
            const s = await newPage();
            await s.page.goto(`${TODAY}/office`, { waitUntil: "networkidle" });
            await s.page.evaluate(() => localStorage.setItem("sme_office_view", "list"));
            await s.page.reload({ waitUntil: "networkidle" });
            await s.page.locator('[data-screen="office"]').waitFor({ timeout: 30_000 });
            await sleep(500);
            const body = await s.page.locator('[data-screen="office"]').innerText();
            if (id === "construction") check(/Site Measurer/.test(body) && /Dispatch Desk/.test(body), `${label}: the helpers are not named Site Measurer and Dispatch Desk`);
            if (id === "education") check(/Fee Desk/.test(body) && /Notice Desk/.test(body) && /Admissions Desk/.test(body), `${label}: the helpers are not named Fee Desk, Notice Desk and Admissions Desk`);
            if (id === "textiles") check(/Quote Writer/.test(body) && /Order Desk/.test(body), `${label}: the helpers lost their names`);
            await save(s.page, `office-${id}`, `the Office for ${id}: the helpers carry the business type's names`, { fullPage: true });
            problems.push(...s.errors.map((e) => `${label} office: ${e}`));
            await s.context.close();
          }

          // a part the business type does not have: a typed address answers 403, and so does a move inside the app (a link)
          if (want("guard") && id !== "textiles") {
            const off = id === "education" ? "orders" : "fees";
            const s = await newPage();
            const response = await s.page.goto(`${TODAY}/${off}`, { waitUntil: "networkidle" });
            void response;
            check((await s.page.locator('[data-problem="403"]').count()) === 1, `${label}: no 403 page for the typed address /${off}`);
            check(/not switched on/.test(await s.page.locator('[data-problem="403"]').innerText()), `${label}: the 403 page does not say the part is not switched on`);
            check((await s.page.locator("nav[aria-label='Workspace menu'], nav[aria-label='Quick menu']").count()) >= 1, `${label}: the 403 page lost the frame`);
            await save(s.page, `forbidden-${id}`, `the 403 page for /${off}, a part ${id} does not have`);
            // a move inside the app (no page load): Today, then the router goes to the part
            await s.page.goto(TODAY, { waitUntil: "networkidle" });
            await s.page.evaluate((to) => window.next.router.push(to), `/app/tenants/${TENANT}/${off}`);
            await s.page.locator('[data-problem="403"]').waitFor({ timeout: 15_000 }).catch(() => null);
            if ((await s.page.locator('[data-problem="403"]').count()) !== 1) problems.push(`${label}: a move inside the app to /${off} did not answer the 403 page (at ${new URL(s.page.url()).pathname.replace(TENANT, "T")}: ${(await s.page.locator("main").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120)})`);
            else await save(s.page, `forbidden-${id}-moved`, `a move inside the app to /${off}, a part ${id} does not have: the same 403 page`);
            problems.push(...s.errors.map((e) => `${label} guard: ${e}`));
            await s.context.close();
          }
        }
        Object.assign(PACK_STATE, { pack: null, example: "none", town: null });
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
  console.log(`${written.length} pictures in ${OUT}${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();
