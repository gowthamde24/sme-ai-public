// Pictures of "the assistant does the work" chat cards (job assistant-does-the-work, C2 part), from the REAL web app on the visual tests' invented backend (stand-in.mjs): no database, no keys, no network
// after the build, no real person. The web app runs with ASSISTANT_WORK_SCREENS=mock, so the cards answer from fixtures in the browser and no file leaves the page.
//
//   node e2e/visual/aw-shots.mjs [--no-build] [--out DIR] [--only preview,today,activity,chat-plus,chat-pdf]
//
// chat-plus: the chat's "+" menu open, with "Add a file" and the kinds it takes. chat-pdf: a made-up PDF picked in the chat and sent, answered (in the browser, mock mode) with the contract's honest
// "can't do yet" card. Both need the chat, so the build has BROWSER_VOICE=1 too (nothing is dialled or spoken: the pictures never press the microphone).
//
// Saves full-page pictures (390 and 1440 wide, light and dark, English and Telugu) to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-aw). It compares nothing (that is run.mjs).
// Same ports and guards as run.mjs (54999, 3014); it starts and stops only its own processes, by their own process ids.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { API_ROUTES, FIXED_NOW, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ONLY = (arg("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-aw"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const FLAGS = { ASSISTANT_WORK_SCREENS: "mock", BROWSER_VOICE: "1" };

/** The Main agent is up for these pictures (the stand-in's own list says "not available", and the chat would be off); everything else of the list stays as the stand-in has it (as e2e/ask-stream-shots.mjs). */
const AGENTS_ROUTE = [
  "GET",
  /^\/v1\/tenants\/[0-9a-f-]{36}\/agents\/status$/,
  (req, res) => {
    const route = API_ROUTES.find(([p]) => p.test(`/v1/tenants/${TENANT}/agents/status`));
    const list = typeof route[1] === "function" ? route[1]({ url: new URL("https://x/"), match: [] }) : route[1];
    const items = (Array.isArray(list) ? list : list.items ?? list).map((a) => (a.agent === "main" ? { ...a, state: "idle", job: "Answers questions about the business." } : a));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(Array.isArray(list) ? items : { ...list, items }));
  },
];

/** The chat on the page: Today's own card, else the floating panel the orb opens. */
async function openChat(page) {
  const form = page.locator("[data-chat=form]").filter({ visible: true }).first();
  if (!(await form.count())) {
    const orb = page.locator("[data-ask=orb]").filter({ visible: true }).first();
    if (await orb.count()) await orb.click();
  }
  await form.waitFor({ state: "visible", timeout: 15_000 });
  return form;
}
/** A made-up file, made here (never a real document): a few bytes with a PDF's first line. */
const FAKE_PDF = { name: "brochure-diwali.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% made up for the pictures\n") };

const SCREENS = [
  { id: "preview", path: `/app/tenants/${TENANT}/assistant-work-preview` },
  { id: "activity", path: `/app/tenants/${TENANT}/settings?section=activity&range=week` },
  { id: "today", path: `/app/tenants/${TENANT}` },
  {
    id: "chat-plus",
    path: `/app/tenants/${TENANT}`,
    act: async (page) => {
      const form = await openChat(page);
      await form.locator("[data-chat=plus]").click();
      const menu = page.locator("[data-chat=plus-menu]").filter({ visible: true }).first();
      await menu.waitFor({ state: "visible", timeout: 10_000 });
      await menu.scrollIntoViewIfNeeded();
    },
  },
  {
    id: "chat-pdf",
    path: `/app/tenants/${TENANT}`,
    act: async (page) => {
      const form = await openChat(page);
      await form.locator("[data-chat=file-input]").setInputFiles(FAKE_PDF);
      await form.locator("[data-chat=file-chip][data-status=ready]").waitFor({ timeout: 10_000 });
      await form.locator("button[type=submit]").click();
      const card = page.locator("[data-work=cant-do]").filter({ visible: true }).first();
      await card.waitFor({ state: "visible", timeout: 10_000 });
      await card.scrollIntoViewIfNeeded();
    },
  },
];
const SIZES = { "390": { width: 390, height: 844 }, "1440": { width: 1440, height: 900 } };
const SCHEMES = ["light", "dark"];
const LANGS = ["en", "te"];

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  const session = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER };
  return `base64-${b64url(JSON.stringify(session))}`;
}
const connect = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
async function waitForPort(port, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await connect(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aw-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL, ...FLAGS };
  if (!process.argv.includes("--no-build")) {
    console.log("aw-shots: building the web app against the stand-in");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: [AGENTS_ROUTE] });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  web.stdout.on("data", (d) => (log += d));
  web.stderr.on("data", (d) => (log += d));
  const stop = async () => {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  process.on("SIGINT", () => stop().then(() => process.exit(130)));
  const rows = [];
  try {
    await waitForPort(WEB_PORT);
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const screen of SCREENS) {
      if (ONLY.length && !ONLY.includes(screen.id)) continue;
      for (const [size, viewport] of Object.entries(SIZES))
        for (const scheme of SCHEMES)
          for (const lang of LANGS) {
            const name = `aw-${screen.id}-${size}-${scheme}-${lang}`;
            const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce", locale: lang === "te" ? "te-IN" : "en-IN", timezoneId: "Asia/Kolkata", isMobile: size === "390", hasTouch: size === "390" });
            await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
            try {
              const res = await page.goto(`${WEB_URL}${screen.path}`, { waitUntil: "networkidle", timeout: 60_000 });
              await page.evaluate(() => document.fonts.ready);
              if (screen.act) await screen.act(page);
              await page.waitForTimeout(300);
              // a screen that was acted on is taken as the person sees it (the window, scrolled to its part): a full-page picture would draw the fixed bars in the middle of the page
              await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !screen.act, animations: "disabled", caret: "hide" });
              const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
              const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
              const flags = [res?.status() !== 200 ? `HTTP ${res?.status()}` : "", wide ? "horizontal scroll" : "", /machine[- ]translat|translated automatically/i.test(body) ? "machine-translation notice" : "", /\b[a-z]+\.[a-z_]+\.[a-z_]+\b/.test(body.replace(/\S+@\S+|https?:\S+/g, "")) ? "maybe a raw key" : "", errors.length ? `page errors: ${errors.join(" | ")}` : ""].filter(Boolean);
              rows.push(`${flags.length ? "CHECK" : "ok   "} ${name}${flags.length ? `  ${flags.join("; ")}` : ""}`);
            } catch (e) {
              // what the page had instead, so a screen that never showed its part says why (the parts' data attributes, the address)
              const seen = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-ask],[data-chat]")].map((el) => `${el.getAttribute("data-ask") ? `ask=${el.getAttribute("data-ask")}` : `chat=${el.getAttribute("data-chat")}`}`))].slice(0, 20).join(" ")).catch(() => "");
              rows.push(`ERROR ${name}: ${String(e.message).split("\n")[0]} (at ${page.url().replace(WEB_URL, "")}; parts: ${seen || "none"})`);
            }
            await context.close();
          }
    }
    await browser.close();
    console.log(rows.join("\n"));
    if (standIn.misses.size) console.log(`\naw-shots: the stand-in had no fixture for:\n  ${[...standIn.misses].sort().join("\n  ")}`);
  } catch (e) {
    console.error(`aw-shots: ${e.message}\n--- web log (tail) ---\n${log.slice(-1500)}`);
  } finally {
    await stop();
  }
}

main();
