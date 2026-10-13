// The visual tests (job BX): pictures of the main screens (Today, Visits, Outbox, Catalogue, a lead page, Settings, the landing page) at a phone width (360) and on a desktop, light and dark, in English and Telugu,
// compared with the pictures kept in baselines/<platform>/. Runs on its own invented backend (stand-in.mjs): no database, no keys, no network after the build, so it can run in CI without secrets.
//
//   node e2e/visual/run.mjs                 # compare with the baselines (exit 1 if a picture changed)
//   node e2e/visual/run.mjs --update        # (re)write the baselines of this platform
//   options: --only today,landing   --no-build (reuse the last visual build)   --out DIR (where changed pictures and diffs go; default e2e/visual/out, git-ignored)
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

import { FIXED_NOW, LEAD, SESSION_USER, TENANT } from "./fixtures.mjs";
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
  { id: "landing", path: "/", signedIn: false },
];
const SIZES = { phone: { width: 360, height: 780 }, desktop: { width: 1280, height: 800 } };
const SCHEMES = ["light", "dark"];
const LANGS = ["en", "te"];

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
    const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"] });
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
            const name = `${screen.id}-${sizeName}-${scheme}-${lang}`;
            const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce", locale: lang === "te" ? "te-IN" : "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
            // the plush owlet (job CI) is drawn as its still picture: its layer files are refused, so the owl never starts to move and a picture cannot differ from run to run
            await context.route(/\/owl\/owlet-(head|body|beak|wing-left|wing-right)\.webp/, (route) => route.abort());
            await context.addCookies([
              { name: "sme_consent", value: "1.a0", url: WEB_URL },
              { name: "sme_lang", value: lang, url: WEB_URL },
              ...(screen.signedIn ? [{ name: "sb-127-auth-token", value: cookieValue, url: WEB_URL }] : []),
            ]);
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
              const shot = await page.screenshot({ type: "jpeg", quality: 70, animations: "disabled", caret: "hide" });
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
