// The browser checks of ADR 0072 (the Host-header question) through a custom address in front of Cloud Run: sign-in and the cookie (check 2), a Server Action (3), a ~4 MB upload (4), an Ask answer
// that streams to the end (5). Checks 1 and 6 are curl checks (make hosted-smoke; forged X-Forwarded-Host). Job DC.
// Usage:  node e2e/staging-domain-checks.mjs https://staging.stack19.com <photo.jpg of about 4 MB> <materials item id of the construction demo workspace>
// Same safety as staging-smoke.mjs: staging web addresses only, the synthetic demo owners only. The Ask question costs about one tenth of a rupee.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { signIn, record, results } from "./staging-smoke.mjs";

const WEB = (process.argv[2] || "").replace(/\/$/, "");
const PHOTO = process.argv[3];
const ITEM = process.argv[4];
const browser = await chromium.launch();

async function tenantOf(page) {
  await page.goto(`${WEB}/app`);
  const href = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href").catch(() => null);
  return href ? href.split("/")[3] : page.url().split("/")[5];
}

// ---- textiles owner: checks 2, 3, 5
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const r = await signIn(page, "textiles");
  record("2 sign-in works through the public address", r.ok ? "PASS" : "FAIL", `now at ${new URL(page.url()).pathname} on ${new URL(page.url()).host}`);
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  const host = new URL(WEB).hostname;
  const good = cookies.length > 0 && cookies.every((c) => c.domain === host && c.httpOnly && c.secure && c.sameSite === "Lax" && c.path === "/");
  record("2 the session cookie is host-only on the public host (HttpOnly, Secure, SameSite=Lax, no Domain widening)", good ? "PASS" : "FAIL", cookies.map((c) => `${c.name.replace(/-auth-token.*/, "-auth-token")}: domain=${c.domain} httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite}`).join("; ") || "no sb- cookie");
  const tenant = await tenantOf(page);

  // 3: a Server Action: the new-customer form saves through a server action
  try {
    const stamp = Date.now();
    await page.goto(`${WEB}/app/tenants/${tenant}/customers/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.getByLabel("Customer's name").fill(`Smoke test customer ${stamp} (synthetic)`);
    await page.getByLabel("WhatsApp or phone number").fill("+00 90002 00077");
    await page.getByRole("button", { name: "Add this customer" }).click();
    await page.getByRole("status").waitFor({ timeout: 30000 });
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const refused = /invalid server actions request|forbidden|not allowed/i.test(body);
    record("3 a Server Action saves (the new-customer form)", refused ? "FAIL" : "PASS", `answer: ${(await page.getByRole("status").first().innerText()).slice(0, 100)}`);
  } catch (e) {
    record("3 a Server Action saves (the new-customer form)", "FAIL", String(e).split("\n")[0].slice(0, 200));
  }

  // 5: Ask streams to the end
  try {
    await page.goto(`${WEB}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    const box = page.getByPlaceholder(/Ask anything/);
    await box.fill("What needs me today? Answer in two short sentences.");
    const t0 = Date.now();
    const asked = page.waitForResponse((resp) => /\/tenants\/[0-9a-f-]{36}\/ask$/.test(new URL(resp.url()).pathname) && resp.request().method() === "POST", { timeout: 60000 }).catch(() => null);
    await page.locator('[data-ask="live"] button[type="submit"]').first().click();
    const resp = await asked;
    // wait until the answer has stopped changing for 4 seconds, then read the thread
    let last = "", stable = 0;
    for (let i = 0; i < 40 && stable < 4; i++) {
      await page.waitForTimeout(1000);
      const now = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    const errorShown = /something went wrong|try again|couldn't|could not|error/i.test(last.slice(last.lastIndexOf("What needs me today")));
    const answered = last.includes("What needs me today") && last.length > 0;
    record("5 an Ask answer streams through the public address without being cut", resp && resp.status() === 200 && answered && !errorShown ? "PASS" : "FAIL", `HTTP ${resp ? resp.status() : "none"}, took about ${Math.round((Date.now() - t0) / 1000)} s, content-type ${resp ? resp.headers()["content-type"] : "?"}`);
  } catch (e) {
    record("5 an Ask answer streams through the public address", "FAIL", String(e).split("\n")[0].slice(0, 200));
  }
  await context.close();
}

// ---- construction owner: check 4, a ~4 MB photo through the Next route (the browser's own fetch, so Sec-Fetch-Site is real)
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  try {
    const r = await signIn(page, "construction_materials");
    const tenant = await tenantOf(page);
    await page.goto(`${WEB}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    const b64 = readFileSync(PHOTO).toString("base64");
    const out = await page.evaluate(async ({ b64, tenant, item, id }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const resp = await fetch(`/app/tenants/${tenant}/materials/${item}/photos?photo_id=${id}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: bytes });
      return { status: resp.status, text: (await resp.text()).slice(0, 160), bytes: bytes.length };
    }, { b64, tenant, item: ITEM, id: randomUUID() });
    record("4 a ~4 MB photo upload through the public address", r.ok && out.status === 200 && out.text.includes('"ok":true') ? "PASS" : "FAIL", `${out.bytes} bytes sent, HTTP ${out.status}, ${out.text.slice(0, 100)}`);
  } catch (e) {
    record("4 a ~4 MB photo upload through the public address", "FAIL", String(e).split("\n")[0].slice(0, 200));
  }
  await context.close();
}
await browser.close();
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
