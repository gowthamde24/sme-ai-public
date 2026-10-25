// When does each piece of an Ask answer reach the browser through the public address? (job DG) Signs in as a synthetic demo owner on STAGING, posts one question to the web's own /ask route
// from inside the page (the browser's own fetch, so the request is the real one) and prints, per chunk, the milliseconds since the request: the first chunk (a `step`) must come early, the answer later.
// Usage:  node e2e/staging-stream-proof.mjs https://staging.stack19.com [pack: construction_materials|education|textiles]
// Same safety as the other staging scripts: staging web addresses only, the synthetic demo owners only. One question costs about a tenth of a rupee.
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { signIn } from "./staging-smoke.mjs";

const WEB = (process.argv[2] || "").replace(/\/$/, "");
const PACK = process.argv[3] || "construction_materials";
const QUESTION = process.argv[4] || "Go through my recent quotes and enquiries and, in one full sentence each, tell me where each one stands and what I should do next.";
if (!/^https:\/\/staging\./.test(WEB)) throw new Error("staging addresses only");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const r = await signIn(page, PACK);
if (!r.ok) throw new Error("sign-in failed");
await page.goto(`${WEB}/app`);
const href = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href").catch(() => null);
const tenant = (href ?? page.url()).split("/")[3] ?? page.url().split("/")[5];
await page.goto(`${WEB}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
const out = await page.evaluate(async ({ tenant, id, text }) => {
  const t0 = performance.now();
  const seen = [];
  const resp = await fetch(`/app/tenants/${tenant}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, messageId: id }) });
  seen.push({ ms: Math.round(performance.now() - t0), what: `headers HTTP ${resp.status} ${resp.headers.get("content-type")}` });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.trim()) continue;
      let label = "line";
      try { const e = JSON.parse(line); label = e.type + (e.type === "text" ? ` (${e.delta.length} chars)` : e.type === "error" ? ` code=${e.code}` : ""); } catch { /* not JSON */ }
      seen.push({ ms: Math.round(performance.now() - t0), what: label });
    }
  }
  return seen;
}, { tenant, id: randomUUID(), text: QUESTION });
for (const s of out) console.log(`${String(s.ms).padStart(6)} ms  ${s.what}`);
const first = out.find((s) => s.what.startsWith("step"));
const text = out.find((s) => s.what.startsWith("text"));
console.log(`-> first step at ${first ? first.ms : "none"} ms; first answer text at ${text ? text.ms : "none"} ms; ${out.length - 1} events`);
await browser.close();
process.exit(first && text && first.ms < text.ms - 500 ? 0 : 1);
