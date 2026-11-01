// Helpers of job DF, the click-through of the web screens on staging (e2e/staging-clickthrough.mjs). Staging only: https://staging.stack19.com, the three synthetic demo owners.
// Their passwords and authenticator secrets come from Google Secret Manager through `gcloud` into this process's memory (staging-smoke.mjs); nothing secret is printed, logged, written or photographed:
// pictures are taken only after sign-in, and no screen shows a password or a code (the sign-in page is never photographed while a secret is typed).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const GCP_PROJECT = "project-2757c07e-37d2-4167-88f";
export const WEB = "https://staging.stack19.com"; // the only address these scripts talk to
const secret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${GCP_PROJECT}`], { encoding: "utf8" });

function totp(b32, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of b32.trim().toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

export const results = [];
export function record(id, status, note, shot) {
  results.push({ id, status, note, shot });
  console.log(`${status.padEnd(5)} ${id} :: ${note}${shot ? "  [" + shot + "]" : ""}`);
}

/** Password, then the second factor when asked. The secrets live in this function's variables only. One more try if the password step does not move on (a slow cold start of the web or the API). */
export async function signIn(page, pack, attempt = 1) {
  const email = `demo-${pack.replace(/_/g, "-")}@demo.example.test`;
  const t0 = Date.now();
  try {
    await page.goto(`${WEB}/login`);
    await page.fill('input[name="email"]', email, { timeout: 45000 });
    await page.fill('input[name="password"]', secret(`sme-demo-${pack}-password`).trim());
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(app|auth\/mfa)/, { timeout: 45000 });
    if (/\/auth\/mfa/.test(page.url())) {
      const seed = secret(`sme-demo-${pack}-totp`);
      for (const offset of [0, 1, -1]) {
        await page.fill('input[name="code"]', totp(seed, offset), { timeout: 45000 });
        await Promise.all([page.waitForURL(/\/app/, { timeout: 15000 }).catch(() => null), page.click('button:has-text("Verify")')]);
        if (/\/app/.test(page.url())) break;
      }
    }
  } catch (e) {
    if (attempt >= 2) throw e;
    return signIn(page, pack, attempt + 1); // one more try: a slow cold start of the web or the API at the password or the second-factor step
  }
  return { ok: /\/app/.test(page.url()), ms: Date.now() - t0, attempts: attempt };
}

/** A fresh authenticator code for the second-factor step-up some screens ask for (approving a quote or a campaign). */
export const code = (pack) => totp(secret(`sme-demo-${pack}-totp`));
export const PACKS = ["textiles", "construction_materials", "education"];
export const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
export const SHOTS = process.env.DF_SHOTS || path.join(os.homedir(), "Desktop", "v2-overnight", "shots-df");
mkdirSync(SHOTS, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a browser, sign in as the owner of `pack` at `size`; returns { browser, context, page, tenant, base, errors, ms }. */
export async function session(pack, size = "desktop", opts = {}) {
  const browser = opts.browser ?? (await chromium.launch());
  const context = await browser.newContext({ viewport: SIZES[size], locale: "en-IN", timezoneId: "Asia/Kolkata", reducedMotion: process.env.DF_MOTION ? "no-preference" : "reduce", isMobile: size === "phone", hasTouch: size === "phone", deviceScaleFactor: size === "phone" ? 2 : 1 });
  await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB }]); // the cookie notice answered (analytics off), so it does not sit on every picture; the notice itself is not under test
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  const r = await signIn(page, pack);
  if (!r.ok) throw new Error(`sign-in of ${pack} failed (now at ${new URL(page.url()).pathname})`);
  await page.goto(`${WEB}/app`, { waitUntil: "domcontentloaded" });
  const href = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href").catch(() => null);
  const tenant = href ? href.split("/")[3] : /\/app\/tenants\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!tenant) throw new Error("no workspace found after sign-in");
  return { browser, context, page, tenant, base: `${WEB}/app/tenants/${tenant}`, errors, ms: r.ms, attempts: r.attempts, own: !opts.browser };
}

export async function go(s, p, { wait = true } = {}) {
  const t0 = Date.now();
  const res = await s.page.goto(p.startsWith("http") ? p : `${s.base}${p}`, { waitUntil: "domcontentloaded" });
  if (wait) await s.page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => null);
  return { status: res?.status(), ms: Date.now() - t0 };
}

/** The browser's own timings of the page just loaded: time to first byte, DOMContentLoaded and load, in ms from the start of the navigation. */
export const navTiming = (page) =>
  page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
  });

export async function shot(s, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  await s.page.screenshot({ path: file, fullPage: opts.fullPage ?? true });
  return path.basename(file);
}

/** A compact outline of the page: title, h1/h2, buttons, links count, labelled fields, alerts: what a person sees. */
export async function outline(page) {
  return page.evaluate(() => {
    const txt = (e) => (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 70);
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const list = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(txt).filter(Boolean);
    const fields = [...document.querySelectorAll("input,select,textarea")].filter((e) => vis(e) && e.type !== "hidden").map((e) => {
      const l = e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.placeholder || e.name || e.id;
      return `${e.tagName.toLowerCase()}${e.type ? ":" + e.type : ""}[${(l || "").replace(/\s+/g, " ").trim().slice(0, 50)}]`;
    });
    return { title: document.title, path: location.pathname + location.search, h1: list("h1"), h2: list("h2").slice(0, 12), buttons: list("button,[role=button]").slice(0, 40), links: list("a[href]").length, linkSample: [...document.querySelectorAll("main a[href]")].filter(vis).slice(0, 25).map((a) => `${txt(a)} -> ${a.getAttribute("href").replace(/^\/app\/tenants\/[0-9a-f-]{36}/, "~")}`), fields, alerts: list("[role=alert],[role=status]"), text: (document.querySelector("main")?.innerText || document.body.innerText).replace(/\s+/g, " ").slice(0, 600) };
  });
}
