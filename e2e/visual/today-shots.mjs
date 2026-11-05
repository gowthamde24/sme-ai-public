// Pictures of Today with the Lead Finder's rows (owner's screenshot, 5 Nov 2026): the visual tests' invented backend (stand-in.mjs: no database, no keys, no network after the build, no real person) plus a Lead Finder
// that is available, sixteen made-up businesses that need the owner (the first five listed) and the stand-in's own things that wait (four and a proposed visit), so "Needs you" says 21 with "See all (21)", the customers' things first.
//
//   node e2e/visual/today-shots.mjs [--no-build] [--out DIR]
//
// Writes today-1440.png and today-390.png (the first screenful, light), plus today-1440-all.png and today-390-all.png ("Needs you" with "See all" opened), to DIR (default /Volumes/Stack19/stack19/v2-overnight/shots-today).
// Same ports as run.mjs (54999, 3014); it stops only its own processes. It only looks: nothing is pressed but "See all".
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-today"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// sixteen invented boutiques in made-up areas: the first five are listed (best fit first), the rest are "11 more prospects"
const AREAS = ["Jayanagar", "JP Nagar", "Basavanagudi", "Banashankari", "BTM Layout"];
const NAMES = ["Mallige Silk Boutique", "Ananya Sarees & Boutique", "Navya Designer Boutique", "Sri Gowri Silks", "Kaveri Saree Studio"];
const prospect = (i) => ({
  id: `b1b1b1b1-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  search_id: "a1a1a1a1-0000-4000-8000-000000000001",
  name: NAMES[i],
  category: "Boutique",
  area: AREAS[i],
  phone: "+00 000 5123 4567",
  website: null,
  rating: [4.6, 4.4, 4.3, 4.7, 4.1][i],
  review_count: [212, 96, 58, 301, 44][i],
  lat: 12.93,
  lng: 77.58,
  source: "fixture",
  source_label: "Example search (made-up businesses) 'boutiques Jayanagar Bengaluru', 14 Oct",
  attribution: null,
  status: "needs_owner",
  decision_reason: i === 4 ? "low_stock" : "first_calls",
  fit_score: [93, 90, 88, 86, 71][i],
  fit_reason: "Boutique; we have Kanchi Pattu Bridal in stock",
  stock_match: { matched: ["Kanchi Pattu Bridal"], low: [], enough: true },
  owner_approved: false,
  suppressed: false,
  ask_after: null,
  last_contacted_at: null,
  lead_id: null,
  qualification: null,
  created_at: "2026-10-14T04:30:00Z",
  updated_at: `2026-10-14T04:${String(50 - i).padStart(2, "0")}:00Z`,
});
const json = (body) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const T = `/v1/tenants/${TENANT}`;
const extraRoutes = [
  ["GET", new RegExp(`^${T}/lead-finder/availability$`), json({ available: true, source: "fixture", reason: "ok", upgrade_to: null, audience: "businesses" })],
  ["GET", new RegExp(`^${T}/prospects$`), json({ items: [0, 1, 2, 3, 4].map(prospect), next_cursor: "c5" })],
  ["GET", new RegExp(`^${T}/prospects/stats$`), json({ total: 20, by_status: { needs_owner: 16, skipped: 4 } })],
];

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER }))}`;
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), "today-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("today-shots: building the web app against the stand-in");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  let failed = false;
  try {
    await waitForPort(WEB_PORT);
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const [name, viewport] of [["1440", { width: 1440, height: 1000 }], ["390", { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true, colorScheme: "light", timezoneId: "Asia/Kolkata" });
      await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sme_theme", value: "light", url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${WEB_URL}/app/tenants/${TENANT}`, { waitUntil: "networkidle", timeout: 60_000 });
      const count = (await page.locator("#needs-you [data-count]").getAttribute("data-count")) ?? "?";
      const seeAll = (await page.locator('[data-needs="see-all"]').textContent().catch(() => null)) ?? "(none)";
      const first = await page.locator("[data-needs-row] h3").allTextContents();
      console.log(`${name}: Needs you ${count}, '${seeAll}', rows: ${first.join(" | ")}${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`);
      // the stand-in's own four plus its proposed visit, then 5 + "11 more" businesses: 21 things, and See all says the same number; the customers' things come before the businesses
      const firstProspect = first.indexOf(NAMES[0]);
      if (count !== "21" || seeAll.trim() !== `See all (${count})` || firstProspect < 1 || first.slice(firstProspect).some((n) => !NAMES.includes(n) && !/more prospects$/.test(n)) || errors.length) failed = true;
      await page.screenshot({ path: path.join(OUT, `today-${name}.png`) });
      // and with "See all" opened, every row (the businesses with Call and Skip are under the customers' things)
      await page.click('[data-needs="see-all"]');
      await page.locator("#needs-you").screenshot({ path: path.join(OUT, `today-${name}-all.png`) });
      await context.close();
    }
    await browser.close();
    if (standIn.misses.size) console.log(`today-shots: the stand-in had no fixture for: ${[...standIn.misses].join(", ")}`);
    console.log(`today-shots: pictures in ${OUT}`);
  } finally {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

await main();
