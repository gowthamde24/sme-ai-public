// The visual tests (job BX): pictures of the main screens (Today, Visits, Outbox, Catalogue, a lead page, Settings, the landing page) at a phone width (360) and on a desktop, light and dark, in English and Telugu,
// compared with the pictures kept in baselines/<platform>/. Runs on its own invented backend (stand-in.mjs): no database, no keys, no network after the build, so it can run in CI without secrets.
//
//   node e2e/visual/run.mjs                 # compare with the baselines (exit 1 if a picture changed)
//   node e2e/visual/run.mjs --update        # (re)write the baselines of this platform
//   options: --only today,landing   --no-build (reuse the last visual build)   --out DIR (where changed pictures and diffs go; default e2e/visual/out, git-ignored)   --full (whole-page pictures for a review; never with --update)
//
// What it starts, all on this machine, all stopped again by its own process ids: the stand-in backend (https, port 54999), the web app built with the stand-in's addresses (port 3014, `next start`).
// The browser clock and the server clock are both pinned to 14 Oct 2026 10:30 India time; the language, the colour scheme, the cookie notice and the signed-in session are set by cookies and media features, never by clicking.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CALL_DONE, CALL_LIVE, FIXED_NOW, LEAD, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const UPDATE = flag("update");
const ONLY = (arg("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg("out", path.join(HERE, "out")));
const PLATFORM = process.platform; // fonts and anti-aliasing differ by system: each system keeps its own pictures
const BASELINES = path.join(HERE, "baselines", PLATFORM);
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// a picture differs when more than this share of its pixels differ by more than DELTA (of 255) in any colour channel
const DELTA = 24;
const MAX_SHARE = 0.002;

const SCREENS = [
  { id: "today", path: `/app/tenants/${TENANT}`, signedIn: true },
  { id: "visits", path: `/app/tenants/${TENANT}/visits`, signedIn: true },
  { id: "outbox", path: `/app/tenants/${TENANT}/outbox`, signedIn: true },
  { id: "catalogue", path: `/app/tenants/${TENANT}/catalogue`, signedIn: true },
  { id: "lead", path: `/app/tenants/${TENANT}/leads/${LEAD}`, signedIn: true },
  { id: "settings", path: `/app/tenants/${TENANT}/settings`, signedIn: true },
  { id: "office", path: `/app/tenants/${TENANT}/office`, signedIn: true }, // the plush office (job CJ): stills only here (the layer files are refused), so the picture is the same every run
  { id: "landing", path: "/", signedIn: false },
  // app v4 (APP_V4=1 only: the page is a 404 without it)
  { id: "customer", path: `/app/tenants/${TENANT}/customers/${LEAD}`, signedIn: true, v4: true },
  { id: "calls", path: `/app/tenants/${TENANT}/calls`, signedIn: true, v4: true },
  { id: "leads", path: `/app/tenants/${TENANT}/lead-desk`, signedIn: true, v4: true },
  { id: "money", path: `/app/tenants/${TENANT}/money`, signedIn: true, v4: true },
  { id: "catalogue-low", path: `/app/tenants/${TENANT}/catalogue`, signedIn: true, v4: true },
  { id: "map", path: `/app/tenants/${TENANT}/map`, signedIn: true, v4: true },
  { id: "finder", path: `/app/tenants/${TENANT}/retailers`, signedIn: true, v4: true },
  // the live-call bar (owner, 9 Nov 2026): the stand-in API has one live call, so every v4 page shows it; two pages are enough to see it
  { id: "live-today", path: `/app/tenants/${TENANT}`, signedIn: true, v4: true },
  { id: "live-money", path: `/app/tenants/${TENANT}/money`, signedIn: true, v4: true },
  { id: "call-live", path: `/app/tenants/${TENANT}/calls/${CALL_LIVE}`, signedIn: true, v4: true },
  { id: "call-done", path: `/app/tenants/${TENANT}/calls/${CALL_DONE}`, signedIn: true, v4: true },
  // the AI team's report and helpers also need AI_TEAM_SCREENS=mock (the made-up day and stand-up of lib/api/ai-team-fixtures.ts)
  { id: "aiteam-report", path: `/app/tenants/${TENANT}/ai-team?tab=report`, signedIn: true, v4: true },
  { id: "aiteam-remake", path: `/app/tenants/${TENANT}/ai-team?tab=report`, signedIn: true, v4: true, prep: "remake" }, // "Make it again" pressed: the left menu must keep its width in the picture (owner's question, 9 Nov)
  { id: "aiteam-helpers", path: `/app/tenants/${TENANT}/ai-team?tab=helpers`, signedIn: true, v4: true },
  // voice typing (owner decision, 9 Nov 2026) on Train how it talks: needs BROWSER_VOICE=1 and TALK_TRAINING_SCREENS=1; a fake voice socket and a fake microphone stand in (see `voice` below)
  // the one-line fields of app v4 (owner, 9 Nov 2026: a before and after picture of every field that got a microphone): the search box (Ctrl+K)
  // app v4 parts 8 and 9: the Settings tabs of Limits, Plan and Notifications
  { id: "settings-limits", path: `/app/tenants/${TENANT}/settings?section=limits`, signedIn: true, v4: true },
  { id: "settings-plan", path: `/app/tenants/${TENANT}/settings?section=plan`, signedIn: true, v4: true },
  { id: "settings-notifications", path: `/app/tenants/${TENANT}/settings?section=notifications`, signedIn: true, v4: true },
  { id: "everything", path: `/app/tenants/${TENANT}/everything`, signedIn: true, v4: true },
  { id: "field-palette", path: `/app/tenants/${TENANT}`, signedIn: true, v4: true, prep: "palette" },
  { id: "field-palette-listening", path: `/app/tenants/${TENANT}`, signedIn: true, v4: true, prep: "palette-listening" },
  // before and after pictures of the other fields that got a microphone (owner, 9 Nov 2026)
  { id: "field-correct", path: `/app/tenants/${TENANT}/calls/${CALL_DONE}`, signedIn: true, v4: true, prep: "correct" },
  { id: "field-outbox", path: `/app/tenants/${TENANT}/outbox`, signedIn: true, v4: true, prep: "edit" },
  { id: "field-needs", path: `/app/tenants/${TENANT}`, signedIn: true, v4: true, prep: "edit" },
  { id: "field-evidence", path: `/app/tenants/${TENANT}/leads/${LEAD}?section=evidence`, signedIn: true, v4: true, prep: "evidence" },
  { id: "field-about", path: `/app/tenants/${TENANT}/settings?section=assistant`, signedIn: true, v4: true, prep: "about" },
  { id: "field-contact", path: `/app/tenants/${TENANT}/leads/${LEAD}`, signedIn: true, v4: true, prep: "contact" },
  { id: "voice-idle", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true, voice: "idle" },
  { id: "voice-listening", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true, voice: "listening" },
  { id: "voice-error", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true, voice: "error" },
  { id: "voice-guided", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true, voice: "guided" },
  { id: "voice-review", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true, voice: "review" },
  // Train how it talks also needs TALK_TRAINING_SCREENS=1
  { id: "training", path: `/app/tenants/${TENANT}/ai-team/training`, signedIn: true, v4: true },
].filter((s) => !s.v4 || process.env.APP_V4 === "1");
// --widths 1024,1280,1366 (owner, 9 Nov 2026): only those desktop widths (named w1024 ...), no phone; one picture each
const WIDTHS = (arg("widths", "") || "").split(",").filter(Boolean); // "1366" or "1366x768" (the height; 800 when not said)
const SIZES = WIDTHS.length ? Object.fromEntries(WIDTHS.map((w) => [`w${w}`, { width: Number(w.split("x")[0]), height: Number(w.split("x")[1] ?? 800) }])) : { phone: { width: 360, height: 780 }, ...(flag("phone390") ? { phone390: { width: 390, height: 844 } } : {}), desktop: { width: flag("wide") ? 1440 : 1280, height: 800 } };
const SCHEMES = ["light", "dark"];
const LANGS = flag("kn") ? ["en", "te", "kn"] : ["en", "te"];
// --combos light-en,dark-en,light-te,light-kn: only these colour-scheme and language pairs (the review set)
const COMBOS = arg("combos", "") ? arg("combos", "").split(",") : null;

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800, iat: 1790000000 });
  const session = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER };
  return `base64-${b64url(JSON.stringify(session))}`;
}

async function waitForPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}
const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

function buildWeb(env) {
  console.log("visual: building the web app against the stand-in (this takes a minute or two)");
  rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
  execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
}

/** Compares two images (data URLs) in the browser's canvas: no image library is needed. Returns the share of differing pixels and a diff picture. */
async function compare(page, expected, actual) {
  return page.evaluate(
    async ({ expected, actual, delta }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("image did not load"));
          img.src = src;
        });
      const [a, b] = await Promise.all([load(expected), load(actual)]);
      if (a.width !== b.width || a.height !== b.height) return { share: 1, sizeDiffers: `${a.width}x${a.height} vs ${b.width}x${b.height}`, diff: null };
      const draw = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height);
      };
      const da = draw(a);
      const db = draw(b);
      const out = new ImageData(a.width, a.height);
      let different = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
        if (d > delta) {
          different += 1;
          out.data[i] = 255;
          out.data[i + 1] = 0;
          out.data[i + 2] = 80;
          out.data[i + 3] = 255;
        } else {
          out.data[i] = db.data[i];
          out.data[i + 1] = db.data[i + 1];
          out.data[i + 2] = db.data[i + 2];
          out.data[i + 3] = 70;
        }
      }
      const c = document.createElement("canvas");
      c.width = a.width;
      c.height = a.height;
      c.getContext("2d").putImageData(out, 0, 0);
      return { share: different / (a.width * a.height), diff: different ? c.toDataURL("image/png") : null };
    },
    { expected, actual, delta: DELTA },
  );
}

/** The page's voice socket and microphone for the voice-typing pictures: a socket that only the picture's script speaks through (window.__ws), and, for "error", a microphone the browser refuses. */
const FAKE_VOICE = (refuse) => `(() => {
  const Real = window.WebSocket;
  window.WebSocket = class { constructor(url) { if (!String(url).includes("/voice-chat")) return new Real(url); this.url = url; this.readyState = 0; this.sent = []; window.__ws = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30); } send(d) { this.sent.push(d); } close() { this.readyState = 3; } };
  ${refuse ? "navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));" : "const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => real(c).catch(() => new MediaStream());"}
})();`;
const say = (page, m) => page.evaluate((x) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(x) }), m);
async function prepareVoice(page, kind) {
  const mic = (scope) => page.locator(`${scope} [data-part="mic"]`).first();
  if (kind === "idle") return;
  if (kind === "listening" || kind === "error") {
    await mic('[data-part="tt-greeting"]').click();
    await page.waitForTimeout(400);
    if (kind === "listening") {
      await say(page, { type: "ready", session_id: "s1", language: "te", limits: {} });
      await page.waitForTimeout(150);
      await say(page, { type: "caption", who: "user", text: "నమస్కారం, నేను లక్ష్మి సిల్క్స్ నుండి మాట్లాడుతున్నాను", final: true, spoken: true });
      await page.waitForTimeout(250);
    }
    await page.locator('[data-part="tt-greeting"]').scrollIntoViewIfNeeded();
    return;
  }
  // the guided flow: under "Answers to what customers say"
  await page.locator('[data-part="add-by-speaking"]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-part="add-by-speaking"]').first().click();
  if (kind === "review") {
    await page.locator("#vi-q").fill("Do you have green Kanchi sarees?");
    await page.getByRole("button", { name: /^(Next|తరువాత)$/ }).click();
    await page.locator("#vi-a").fill("Yes, in ten shades. Come to the store or I can send pictures.");
    await page.getByRole("button", { name: /^(Next|తరువాత)$/ }).click();
  }
  await page.locator('[data-part="add-by-speaking-open"]').scrollIntoViewIfNeeded();
}

const dataUrl = (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`;

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) {
    if (await portBusy(port)) throw new Error(`port ${port} is already in use: this run needs it (it is not killed: free it or wait)`);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "visual-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!flag("no-build")) buildWeb(webEnv);
  else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build: run once without it");

  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem") });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW },
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
  process.on("SIGINT", () => stop().then(() => process.exit(130)));

  let failed = 0;
  try {
    await waitForPort(WEB_PORT);
    const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    const judge = await (await browser.newContext()).newPage();
    mkdirSync(OUT, { recursive: true });
    if (UPDATE) mkdirSync(BASELINES, { recursive: true });
    const cookieValue = sessionCookieValue();
    const rows = [];
    for (const screen of SCREENS) {
      if (ONLY.length && !ONLY.includes(screen.id)) continue;
      for (const [sizeName, viewport] of Object.entries(SIZES)) {
        for (const scheme of SCHEMES) {
          for (const lang of LANGS) {
            if (COMBOS && !COMBOS.includes(`${scheme}-${lang}`)) continue;
            const name = `${screen.id}-${sizeName}-${scheme}-${lang}`;
            const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce", locale: lang === "te" ? "te-IN" : lang === "kn" ? "kn-IN" : "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
            // the plush owlet (job CI) is drawn as its still picture: its layer files are refused, so the owl never starts to move and a picture cannot differ from run to run
            await context.route(/\/owl\/v\d+\/[a-z_]+\/owlet-(head|body|beak|wing-left|wing-right)-(512|1024)\.webp/, (route) => route.abort());
            await context.addCookies([
              { name: "sme_consent", value: "1.a0", url: WEB_URL },
              { name: "sme_lang", value: lang, url: WEB_URL },
              ...(screen.signedIn ? [{ name: "sb-127-auth-token", value: cookieValue, url: WEB_URL }] : []),
            ]);
            if (screen.voice) {
              await context.addInitScript(FAKE_VOICE(screen.voice === "error"));
              await context.grantPermissions(["microphone"]).catch(() => null);
            }
            const page = await context.newPage();
            await page.clock.setFixedTime(FIXED_NOW);
            const consoleErrors = [];
            page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)));
            let status = 0;
            try {
              const res = await page.goto(`${WEB_URL}${screen.path}`, { waitUntil: "networkidle", timeout: 60_000 });
              status = res?.status() ?? 0;
              await page.evaluate(() => document.fonts.ready);
              await page.waitForTimeout(250);
              if (screen.prep === "correct") {
                await page.locator('[data-part="call-correct-open"]').first().click().catch(() => null);
                await page.waitForTimeout(400);
                await page.locator('[data-part="call-correct"]').first().scrollIntoViewIfNeeded().catch(() => null);
              }
              if (screen.prep === "edit") {
                if (screen.id === "field-outbox") await page.getByText(/Waiting for you|మీ కోసం/).first().click().catch(() => null);
                if (screen.id === "field-needs") await page.getByText(/Reply to|కు జవాబు/).first().click().catch(() => null);
                await page.waitForTimeout(500);
                const edit = page.getByRole("button", { name: /^(Edit|మార్చండి)$/ }).first();
                await edit.scrollIntoViewIfNeeded().catch(() => null);
                await edit.click().catch(() => null);
                await page.waitForTimeout(400);
                await page.locator('textarea[id$="-edit"]').first().scrollIntoViewIfNeeded().catch(() => null);
              }
              if (screen.prep === "evidence") {
                await page.locator("#evidence-snippet").scrollIntoViewIfNeeded().catch(() => null);
              }
              if (screen.prep === "remake") {
                // the menu's width is watched in the page itself (every 20 ms) from the press until 4 s after it
                await page.evaluate(() => {
                  window.__menuWidths = new Set();
                  const t = setInterval(() => window.__menuWidths.add(Math.round(document.querySelector("aside")?.getBoundingClientRect().width ?? -1)), 20);
                  setTimeout(() => clearInterval(t), 4500);
                });
                await page.locator('[data-part="again"]').first().click().catch(() => null);
                await page.waitForTimeout(4600);
                console.log(`remake ${sizeName}: menu widths seen = ${(await page.evaluate(() => [...window.__menuWidths])).join(", ")} px`);
              }
              if (screen.prep === "about") {
                await page.getByText(/^(Knowledge|జ్ఞానం)$/).first().click().catch(() => null);
                await page.waitForTimeout(500);
                await page.locator("#ctx-notes").scrollIntoViewIfNeeded().catch(() => null);
              }
              if (screen.prep === "contact") {
                await page.getByRole("button", { name: /WhatsApp/ }).first().click();
                await page.waitForTimeout(500);
                await page.locator("#contact-text").scrollIntoViewIfNeeded();
              }
              if (screen.prep === "palette-listening") {
                await page.keyboard.press("Control+k");
                await page.waitForTimeout(500);
                await page.locator('[data-palette] [data-part="mic"]').first().click().catch(() => null);
                await page.waitForTimeout(900);
              }
              if (screen.prep === "palette") {
                await page.keyboard.press("Control+k");
                await page.waitForTimeout(500);
              }
              if (screen.voice) {
                await page.waitForTimeout(600); // (the microphone is a chunk of its own: it arrives a moment after the page)
                await prepareVoice(page, screen.voice);
              }
              // the sidebar scrolls its current row into view when the menu's data arrives, and where it ends depends on which data came first: from the top again, then the same "nearest" scroll the app does, so a picture is the same every run
              await page.evaluate(() => {
                const box = document.querySelector("aside nav");
                if (!box) return;
                box.scrollTop = 0;
                box.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
              });
              // --full (review pictures only, never with --update): the whole page, not the first screen
              const shot = await page.screenshot({ type: "jpeg", quality: 70, animations: "disabled", caret: "hide", fullPage: flag("full") && !UPDATE });
              const file = path.join(BASELINES, `${name}.jpg`);
              if (UPDATE) {
                writeFileSync(file, shot);
                rows.push(`updated  ${name}${status === 200 ? "" : `  (HTTP ${status})`}`);
              } else if (!existsSync(file)) {
                failed += 1;
                writeFileSync(path.join(OUT, `${name}.actual.jpg`), shot);
                rows.push(`MISSING  ${name}: no baseline for ${PLATFORM} (run with --update)`);
              } else {
                const result = await compare(judge, dataUrl(readFileSync(file)), dataUrl(shot));
                if (result.share > MAX_SHARE) {
                  failed += 1;
                  writeFileSync(path.join(OUT, `${name}.actual.jpg`), shot);
                  if (result.diff) writeFileSync(path.join(OUT, `${name}.diff.png`), Buffer.from(result.diff.split(",")[1], "base64"));
                  rows.push(`CHANGED  ${name}: ${result.sizeDiffers ? `size ${result.sizeDiffers}` : `${(result.share * 100).toFixed(2)}% of the pixels differ`} (see ${path.relative(process.cwd(), OUT)})`);
                } else rows.push(`same     ${name}  (${(result.share * 100).toFixed(3)}%)`);
              }
              if (status !== 200) rows.push(`  note: ${name} answered HTTP ${status}`);
              if (consoleErrors.length) rows.push(`  note: ${name} page errors: ${consoleErrors.join(" | ")}`);
            } catch (error) {
              failed += 1;
              rows.push(`ERROR    ${name}: ${String(error.message).split("\n")[0]}`);
            }
            await context.close();
          }
        }
      }
    }
    await browser.close();
    console.log(rows.join("\n"));
    if (standIn.misses.size) {
      console.log(`\nvisual: the stand-in had no fixture for:\n  ${[...standIn.misses].sort().join("\n  ")}`);
      if (!UPDATE) failed += 1;
    }
    if (flag("verbose")) console.log(`\n--- stand-in requests ---\n${[...new Set(standIn.hits)].join("\n")}\n--- web log (tail) ---\n${webLog.slice(-3000)}`);
    console.log(`\nvisual: ${rows.filter((r) => /^(same|updated)/.test(r)).length} ${UPDATE ? "written" : "same"}, ${failed} problem(s) on ${PLATFORM}`);
  } catch (error) {
    console.error(`visual: ${error.message}\n--- web log (tail) ---\n${webLog.slice(-1500)}`);
    failed += 1;
  } finally {
    await stop();
  }
  process.exit(failed ? 1 : 0);
}

main();
