// The speed measurement (job CF): how fast the main screens load on a mid-range Android phone on slow 4G, measured in a real (headless) Chromium with the same throttling Lighthouse uses for "mobile":
// 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up, a 4x slower CPU, a 360 px wide phone screen, a cold cache. Per route it records LCP, FCP, TBT (long tasks after the first paint), INP (one real tap), CLS,
// the JavaScript / CSS / font / image bytes that crossed the wire (gzip), and the request count. Median of --runs runs (default 3).
//
//   node e2e/perf/measure.mjs --label before --out ~/Desktop/v2-overnight/cf-perf-before.json     # build + measure + write
//   options: --no-build (reuse the last perf build)   --only landing,today   --runs 3   --cpu 4   --no-throttle
//
// It runs on the visual tests' invented backend (e2e/visual/stand-in.mjs: no database, no keys, no network after the build), a production build (`next start`) on port 3016, the stand-in on 54999 (the visual tests' port).
// Stops only the two processes it started, by their own process ids. Nothing is sent anywhere. Lighthouse is not in the repository (and is not installed): these are the same lab measures taken with Playwright.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { API_ROUTES, FIXED_NOW, LEAD, SESSION_USER, TENANT } from "../visual/fixtures.mjs";
import { startStandIn } from "../visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const LABEL = arg("label", "run");
const OUT = arg("out", "");
const RUNS = Number(arg("runs", "3"));
const CPU = Number(arg("cpu", "4"));
const LANG = arg("lang", "en"); // the language cookie of the visitor (en | te | hi | kn)
const THROTTLE = !flag("no-throttle");
const DUMP = arg("dump-html", ""); // --dump-html DIR: save the first HTML answer of each route there (to see what is in the document)
const TRACE = flag("trace") ? [] : null; // --trace: print the order and timing of the backend reads of one page load (to see sequential reads)
const API_DELAY = Number(arg("api-delay", "0")); // ms added to every answer of the stand-in: the round trip to a real API / Auth server
const ONLY = (arg("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const STAND_IN_PORT = 54999; // the visual tests' port: their fixtures name the picture server by it (STORAGE_URL), so the catalogue photos load. Never run both at once
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const T = `/app/tenants/${TENANT}`;

// `tap` is what a person touches first on the page: the interaction whose delay (INP) is measured
const ROUTES = [
  { id: "landing", label: "Landing (/)", path: "/", signedIn: false, tap: "button" },
  // job CM: a business type's page (it carries the calculator) and the pricing page, in the same cold-phone conditions; the tap is the first button or link
  { id: "construction", label: "Business type (/construction)", path: "/construction", signedIn: false, tap: "summary" },
  { id: "pricing", label: "Pricing (/pricing)", path: "/pricing", signedIn: false, tap: "summary" },
  { id: "signin", label: "Sign-in (/login)", path: "/login", signedIn: false, tap: "input" },
  { id: "today", label: "Today", path: T, signedIn: true, tap: '[data-notify="bell"]' },
  { id: "outbox", label: "Outbox", path: `${T}/outbox`, signedIn: true, tap: '[data-notify="bell"]' },
  { id: "catalogue", label: "Catalogue", path: `${T}/catalogue`, signedIn: true, tap: '[data-notify="bell"]' },
  { id: "data", label: "Settings > Data", path: `${T}/settings?section=data`, signedIn: true, tap: '[data-notify="bell"]' },
  // job CH: a detail page that reads the lead, its evidence, suggestions, enquiries and customer (the server reads it starts at the same time are what --api-delay shows)
  { id: "lead", label: "Lead page", path: `${T}/leads/${LEAD}`, signedIn: true, tap: '[data-notify="bell"]' },
];

// the Settings > Data reads the visual stand-in does not know: small invented answers, so the page draws its real content
API_ROUTES.push(
  [new RegExp(`^/v1/tenants/${TENANT}/calendar-feed$`), { active: false, feed_url: null, created_at: null }],
  [new RegExp(`^/v1/tenants/${TENANT}/exports/accounting/formats$`), { items: [{ id: "tally", label: "Tally" }, { id: "vyapar", label: "Vyapar" }] }],
  [new RegExp(`^/v1/tenants/${TENANT}/imports$`), { items: [], next_cursor: null }],
);

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("perf-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800, iat: 1790000000 });
  const session = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "perf-refresh", user: SESSION_USER };
  return `base64-${b64url(JSON.stringify(session))}`;
}

const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
async function waitForPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}

// installed before any page script runs
const OBSERVERS = `(() => {
  const p = (window.__perf = { lcp: 0, fcp: 0, shifts: [], long: [], inp: 0, lcpList: [] });
  const watch = (type, fn, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch {} };
  watch("largest-contentful-paint", (e) => { p.lcp = e.startTime; p.lcpList.push([Math.round(e.startTime), e.size, (e.url || "").split("/").pop() || (e.element ? e.element.tagName + "." + String(e.element.className).slice(0, 30) : "")]); });
  watch("paint", (e) => { if (e.name === "first-contentful-paint") p.fcp = e.startTime; });
  watch("layout-shift", (e) => { if (!e.hadRecentInput) p.shifts.push([e.startTime, e.value]); });
  watch("longtask", (e) => { p.long.push([e.startTime, e.duration]); });
  watch("event", (e) => { if (e.interactionId > 0 && e.duration > p.inp) p.inp = e.duration; }, { durationThreshold: 16 });
})();`;

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
/** The worst "session window" of layout shifts (the CLS definition: windows of shifts less than 1 s apart, at most 5 s long). */
function cls(shifts) {
  let best = 0;
  let sum = 0;
  let first = 0;
  let last = 0;
  for (const [t, v] of shifts) {
    if (sum && (t - last > 1000 || t - first > 5000)) sum = 0;
    if (!sum) first = t;
    sum += v;
    last = t;
    best = Math.max(best, sum);
  }
  return best;
}

async function measureOnce(browser, route, cookie) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await context.addCookies([
    { name: "sme_consent", value: "1.a0", url: WEB_URL },
    { name: "sme_lang", value: LANG, url: WEB_URL },
    ...(route.signedIn ? [{ name: "sb-127-auth-token", value: cookie, url: WEB_URL }] : []),
  ]);
  const page = await context.newPage();
  await page.addInitScript(OBSERVERS);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (THROTTLE) {
    if (!flag("no-net")) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }
  const res = new Map(); // requestId -> {url, type, status, cache}
  const bytes = { script: 0, stylesheet: 0, font: 0, image: 0, document: 0, other: 0 };
  const files = { script: [], font: [], image: [] };
  let requests = 0;
  let prefetches = 0; // the router's background reads of the pages the menu links to (?_rsc=)
  const wf = new Map(); // --waterfall: when each request started, got its first byte and finished (ms from the first request)
  let wf0 = 0;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (!wf0) wf0 = e.timestamp;
    wf.set(e.requestId, { url: e.request.url.replace(WEB_URL, "").slice(0, 70), start: (e.timestamp - wf0) * 1000 });
  });
  cdp.on("Network.responseReceived", (e) => {
    const w = wf.get(e.requestId);
    if (w) w.first = (e.timestamp - wf0) * 1000;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const w = wf.get(e.requestId);
    if (w) {
      w.end = (e.timestamp - wf0) * 1000;
      w.kb = e.encodedDataLength / 1024;
    }
  });
  cdp.on("Network.responseReceived", (e) => res.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status, cache: e.response.headers["cache-control"] ?? e.response.headers["Cache-Control"] ?? "" }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = res.get(e.requestId);
    if (!r || r.url.startsWith("data:")) return;
    requests += 1;
    if (r.url.includes("_rsc=")) prefetches += 1;
    const kind = { Script: "script", Stylesheet: "stylesheet", Font: "font", Image: "image", Document: "document" }[r.type] ?? "other";
    bytes[kind] += e.encodedDataLength;
    if (files[kind]) files[kind].push({ url: r.url.replace(WEB_URL, ""), bytes: e.encodedDataLength, cache: r.cache });
  });
  const consoleErrors = []; // a Content-Security-Policy violation or a hydration error shows here
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 140)));
  const t0 = Date.now();
  const response = await page.goto(`${WEB_URL}${route.path}`, { waitUntil: "load", timeout: 120_000 });
  const status = response?.status() ?? 0;
  if (DUMP && response) writeFileSync(path.join(DUMP, `${route.id}.html`), await response.text().catch(() => ""));
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready).catch(() => null);
  // let the page settle (hydration, late chunks), then tap once
  await page.waitForTimeout(2500);
  const loadMs = Date.now() - t0;
  try {
    await page.locator(route.tap).first().click({ timeout: 8000 });
  } catch {
    // no such control on the page: INP is then not measured (reported as n/a)
  }
  await page.waitForTimeout(800);
  const perf = await page.evaluate(() => window.__perf);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd } : { ttfb: 0, dcl: 0 };
  });
  const tbt = perf.long.filter(([s]) => s >= perf.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  if (flag("waterfall")) {
    console.log(`--- ${route.label}: FCP ${perf.fcp.toFixed(0)} ms; requests (start / first byte / end, KB)`);
    for (const w of [...wf.values()].sort((a, b) => a.start - b.start)) console.log(`${w.start.toFixed(0).padStart(6)} ${(w.first ?? NaN).toFixed(0).padStart(6)} ${(w.end ?? NaN).toFixed(0).padStart(6)} ${(w.kb ?? 0).toFixed(1).padStart(7)}  ${w.url}`);
  }
  const out = {
    status,
    ttfb: nav.ttfb,
    fcp: perf.fcp,
    lcp: perf.lcp,
    lcpList: perf.lcpList,
    tbt,
    inp: perf.inp || NaN,
    cls: cls(perf.shifts),
    loadMs,
    requests,
    prefetches,
    errors: consoleErrors.length,
    firstError: consoleErrors[0] ?? "",
    kb: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, v / 1024])),
    files,
  };
  await context.close();
  return out;
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) {
    if (await portBusy(port)) throw new Error(`port ${port} is already in use: this run needs it (nothing is killed: free it or wait)`);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "perf-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!flag("no-build")) {
    console.log("perf: building the web app (a minute or two)");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build: run once without it");

  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), delayMs: API_DELAY, trace: TRACE });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "..", "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW },
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

  const results = {};
  try {
    await waitForPort(WEB_PORT);
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const route of ROUTES) {
      if (ONLY.length && !ONLY.includes(route.id)) continue;
      if (TRACE) {
        TRACE.length = 0;
        const t0 = Date.now();
        await measureOnce(browser, route, cookie);
        console.log(`--- ${route.label}: backend reads of one load (ms from the first)\n${TRACE.map(([t, l]) => `${String(t - TRACE[0][0]).padStart(5)}  ${l.replace(TENANT, "<T>")}`).join("\n")}`);
        void t0;
        continue;
      }
      await measureOnce(browser, route, cookie).catch(() => null); // one warm-up of the server's own caches, not counted
      const runs = [];
      for (let i = 0; i < RUNS; i += 1) runs.push(await measureOnce(browser, route, cookie));
      const m = (key) => median(runs.map((r) => r[key]));
      const kb = (key) => median(runs.map((r) => r.kb[key]));
      results[route.id] = {
        label: route.label,
        status: runs[0].status,
        lcpElements: flag("lcp-detail") ? runs[0].lcpList : undefined, // --lcp-detail: which element was the largest paint, and when (the first run)
        ttfb: m("ttfb"), fcp: m("fcp"), lcp: m("lcp"), tbt: m("tbt"), inp: m("inp"), cls: m("cls"), requests: m("requests"), prefetches: m("prefetches"), errors: m("errors"), firstError: runs.find((r) => r.firstError)?.firstError ?? "",
        kb: { script: kb("script"), stylesheet: kb("stylesheet"), font: kb("font"), image: kb("image"), document: kb("document") },
        files: runs[0].files,
      };
      const r = results[route.id];
      if (flag("lcp-detail")) console.log(`  largest paints of ${route.label} (ms, size, file): ${JSON.stringify(results[route.id].lcpElements)}`);
      console.log(`${route.label.padEnd(18)} HTTP ${r.status}  TTFB ${r.ttfb.toFixed(0)}  FCP ${r.fcp.toFixed(0)}  LCP ${r.lcp.toFixed(0)}  TBT ${r.tbt.toFixed(0)}  INP ${Number.isNaN(r.inp) ? "n/a" : r.inp.toFixed(0)}  CLS ${r.cls.toFixed(3)}  JS ${r.kb.script.toFixed(1)} KB  CSS ${r.kb.stylesheet.toFixed(1)}  font ${r.kb.font.toFixed(1)}  img ${r.kb.image.toFixed(1)}  doc ${r.kb.document.toFixed(1)}  req ${r.requests} (${r.prefetches} prefetch)${r.errors ? `  CONSOLE ERRORS ${r.errors}: ${r.firstError}` : ""}`);
    }
    await browser.close();
    if (standIn.misses.size) console.log(`perf: the stand-in had no fixture for: ${[...standIn.misses].sort().join(", ")}`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ label: LABEL, when: new Date().toISOString(), throttle: THROTTLE ? { rttMs: 150, downMbit: 1.6, upKbit: 750, cpu: CPU } : null, runs: RUNS, results }, null, 2));
  } catch (error) {
    console.error(`perf: ${error.message}\n--- web log (tail) ---\n${webLog.slice(-1500)}`);
    process.exitCode = 1;
  } finally {
    await stop();
  }
}

main();
