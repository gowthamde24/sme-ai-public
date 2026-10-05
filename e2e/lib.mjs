// Shared helpers for the on-demand browser walkthroughs. LOCAL ONLY: every script refuses a non-local URL.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const BASE = process.env.E2E_WEB_URL || "http://localhost:3000";
export const API = process.env.E2E_API_URL || "http://localhost:8000";
export const PW = "Demo-Only-Local-Password-1!"; // the demo seed's fixed password: valid only against a local stack
export const SHOTS = process.env.E2E_SHOTS || path.join(path.dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(SHOTS, { recursive: true });

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
for (const url of [BASE, API]) {
  if (!LOCAL.has(new URL(url).hostname)) {
    console.error(`e2e: refusing to run against ${new URL(url).hostname}: these walkthroughs sign in with the demo password and write data.`);
    process.exit(2);
  }
}

/** The local stack's public URL and publishable key (legacy anon as a fallback), from `supabase status` (the same public values the app itself uses). */
export function supabasePublic() {
  const out = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  const env = Object.fromEntries(out.split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }));
  return { url: env.API_URL, anon: env.PUBLISHABLE_KEY || env.ANON_KEY };
}

export const results = [];
export function record(id, status, note, shot) {
  results.push({ id, status, note, shot });
  console.log(`${status.padEnd(9)} ${id} :: ${note}${shot ? "  [" + shot + "]" : ""}`);
}

export async function launch(viewport = { width: 1280, height: 900 }, opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true, ...opts });
  return { browser, context };
}

export const emailOf = (role) => (role === "owner" ? "demo-owner@demo.example.test" : `demo-${role}@demo.example.test`);

/** RFC 6238 (SHA-1, 6 digits, 30 s). */
export function totp(secretBase32, offsetSteps = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0");
}

/** The LOCAL demo user's authenticator secret, read from the local database container (never a hosted database). */
export function factorSecret(email) {
  const config = execFileSync("cat", [path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "config.toml")], { encoding: "utf8" });
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)[1];
  if (!/^[a-z0-9.@-]+$/.test(email)) throw new Error("unexpected e-mail");
  const out = execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-c",
    `select f.secret from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '${email}' and f.status = 'verified' order by f.created_at limit 1`], { encoding: "utf8" });
  return out.trim();
}

/** Answer the authenticator challenge if the sign-in lands on it. Returns true when a code was typed. */
export async function passChallenge(page, email, { wrongFirst = false } = {}) {
  const secret = factorSecret(email);
  if (!secret) throw new Error(`no authenticator for ${email}`);
  if (wrongFirst) {
    await page.fill('input[name="code"]', "000000");
    await page.click('button:has-text("Verify")');
    await page.waitForSelector('form [role="alert"]', { timeout: 15000 });
  }
  for (const offset of [0, 1, -1]) {
    await page.fill('input[name="code"]', totp(secret, offset));
    await Promise.all([page.waitForURL(/\/app/, { timeout: 8000 }).catch(() => null), page.click('button:has-text("Verify")')]);
    if (/\/app/.test(page.url())) return true;
  }
  throw new Error("the authenticator code was not accepted");
}

export async function login(page, role) {
  const email = emailOf(role);
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(app|auth\/mfa)/, { timeout: 20000 });
  if (/\/auth\/mfa/.test(page.url())) await passChallenge(page, email);
}

export async function shot(page, name, full = true) {
  const p = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: full });
  return p;
}

export const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

/** The demo workspace, its company and its lead, found through the UI itself (no ids to configure). */
export async function discover(page) {
  await page.goto(`${BASE}/app`);
  const tenantHref = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href");
  const tenant = tenantHref.split("/")[3];
  await page.goto(`${BASE}/app/tenants/${tenant}?tab=companies`);
  const company = (await page.locator('a[href*="/companies/"]').first().getAttribute("href")).split("/").pop();
  await page.goto(`${BASE}/app/tenants/${tenant}?tab=leads`);
  const lead = (await page.locator('a[href*="/leads/"]').first().getAttribute("href")).split("/").pop();
  return { tenant, company, lead };
}

/** Measure a page for the phone checklist: horizontal scroll, tappable things under 44px, text that overflows. */
export async function layoutReport(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const out = { vw, scrollW: doc.scrollWidth, hscroll: doc.scrollWidth > vw + 1, small: [], tiny: [], overflowEls: [] };
    for (const el of document.querySelectorAll("a, button, select, input:not([type=hidden]), summary, textarea")) {
      // a radio or a checkbox is tapped through its label: that is the target
      const target = (el.type === "radio" || el.type === "checkbox") && el.closest("label") ? el.closest("label") : el;
      const b = target.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const label = (el.innerText || el.getAttribute("aria-label") || el.name || el.tagName).trim().slice(0, 30);
      if (b.height < 44 || b.width < 44) out.small.push(`${label} ${Math.round(b.width)}x${Math.round(b.height)}`);
      if (b.height < 24 || b.width < 24) out.tiny.push(`${label} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > vw + 1 || (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible")))
        out.overflowEls.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 25)} right=${Math.round(b.right)}`);
    }
    return out;
  });
}
