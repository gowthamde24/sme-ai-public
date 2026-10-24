// Browser smoke test of the STAGING deployment (job DC): sign in with the demo owner of each business type, second factor, Today, logout.
// Usage:  node e2e/staging-smoke.mjs <web url> [shots dir]
// SAFETY: runs only against the stack19-staging web address and only with the three synthetic demo owners made by scripts/seed_staging.py. Their passwords and
// authenticator secrets come from Google Secret Manager (sme-demo-<pack>-password / -totp) through `gcloud` into this process's memory; nothing secret is printed or written.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const GCP_PROJECT = "project-2757c07e-37d2-4167-88f";
const WEB = (process.argv[2] || "").replace(/\/$/, "");
const SHOTS = process.argv[3] || path.join(os.tmpdir(), "staging-shots") // never inside the repository;
if (!/^https:\/\/sme-web-620338396268\.asia-south1\.run\.app$/.test(WEB)) {
  console.error("staging-smoke: refusing to run: the first argument must be the stack19-staging web address.");
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const PACKS = ["textiles", "construction_materials", "education"];
const secret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${GCP_PROJECT}`], { encoding: "utf8" });

function totp(b32, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of b32.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

export const results = [];
export function record(id, status, note) {
  results.push({ id, status, note });
  console.log(`${status.padEnd(5)} ${id} :: ${note}`);
}

export async function signIn(page, pack) {
  const email = `demo-${pack.replace(/_/g, "-")}@demo.example.test`;
  const t0 = Date.now();
  await page.goto(`${WEB}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', secret(`sme-demo-${pack}-password`));
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(app|auth\/mfa)/, { timeout: 30000 });
  if (/\/auth\/mfa/.test(page.url())) {
    const seed = secret(`sme-demo-${pack}-totp`);
    for (const offset of [0, 1, -1]) {
      await page.fill('input[name="code"]', totp(seed, offset));
      await Promise.all([page.waitForURL(/\/app/, { timeout: 10000 }).catch(() => null), page.click('button:has-text("Verify")')]);
      if (/\/app/.test(page.url())) break;
    }
  }
  return { ok: /\/app/.test(page.url()), ms: Date.now() - t0 };
}

export async function main() {
  const browser = await chromium.launch();
  for (const pack of PACKS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // a phone
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    try {
      const r = await signIn(page, pack);
      record(`${pack}: sign in + second factor`, r.ok ? "PASS" : "FAIL", `${r.ms} ms, now at ${new URL(page.url()).pathname}`);
      if (!r.ok) continue;
      await page.goto(`${WEB}/app`);
      const href = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href").catch(() => null);
      const tenantUrl = href ? `${WEB}${href.split("?")[0]}` : page.url();
      await page.goto(tenantUrl);
      await page.waitForLoadState("networkidle").catch(() => null);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      await page.screenshot({ path: path.join(SHOTS, `${pack}-today.png`), fullPage: true });
      record(`${pack}: Today opens`, body.length > 200 && !/something went wrong|application error/i.test(body) ? "PASS" : "FAIL", `${body.length} characters; ${new URL(page.url()).pathname}`);
      // sign out: the phone's "More" sheet, then the session must be gone (a signed-out visit to /app goes to /login)
      await page.getByRole("button", { name: /^More$/ }).or(page.getByText(/^More$/)).first().click();
      await Promise.all([page.waitForURL(/\/login/, { timeout: 20000 }).catch(() => null), page.getByRole("button", { name: /Sign out/ }).first().click()]);
      await page.goto(`${WEB}/app`);
      await page.waitForURL(/\/login/, { timeout: 20000 }).catch(() => null);
      record(`${pack}: sign out ends the session`, /\/login/.test(page.url()) ? "PASS" : "FAIL", `/app after sign out -> ${new URL(page.url()).pathname}`);
    } catch (e) {
      record(`${pack}: browser flow`, "FAIL", String(e).split("\n")[0].slice(0, 200));
    } finally {
      if (errors.length) record(`${pack}: page errors`, "WARN", errors.join(" | "));
      await context.close();
    }
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}
