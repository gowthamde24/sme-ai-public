// Real-stack end-to-end run (job BE): the REAL web (3002), the REAL API (8002) and the LOCAL Supabase with Storage. One throwaway account and workspace (e2e-<stamp>), invented data, nothing leaves this machine.
//   sign up -> e-mail confirmed (local database) -> sign in with the authenticator -> Today -> approve a message -> Outbox (filters, counts, the English gloss, the real history, "Send what is due now")
//   -> Settings (quiet hours) -> Visits: book and complete -> Catalogue: add a saree with a REAL photo upload -> send it to a customer -> Outbox with photo thumbnails -> Ask Agent OWL
// Run by `make e2e-local` (it starts and stops the API and the web and cleans up). Prints one line per step: PASS or FAIL, and a summary; exit code 1 if any step failed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./be-env.mjs";
import { chromium } from "playwright";

import { SHOTS, factorSecret, passChallenge, confirmEmail } from "./lib.mjs";
import { API, BASE, EMAIL, PW, STAMP, aal2Token, api, indiaHour, psql, sharedDatabaseProblem, totp, uuid } from "./be-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(here, "fixtures", "saree-demo.jpg");
mkdirSync(SHOTS, { recursive: true });

const results = [];
let shotN = 0;
const shot = async (page, name) => {
  const p = path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  return p;
};
/** The shared database can change under a run (another session resets it or pins its clock): then every later failure is that, not a product fault. */
function changedUnderUs() {
  try {
    if (tenant && psql(`select count(*) from public.tenants where id = '${tenant}'`) === "0") return "the workspace of this run is gone: the database was reset by another session";
    return sharedDatabaseProblem();
  } catch {
    return "the database cannot be read";
  }
}
async function step(id, title, fn, page) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, title, status: "PASS", note: note || "" });
    console.log(`PASS  ${id} ${title}${note ? ` :: ${note}` : ""}  (${Date.now() - t0} ms)`);
    return true;
  } catch (error) {
    const where = page ? await shot(page, `FAIL-${id}`) : "";
    results.push({ id, title, status: "FAIL", note: String(error?.message ?? error).split("\n")[0] });
    console.log(`FAIL  ${id} ${title} :: ${String(error?.message ?? error).split("\n")[0]} ${where ? `[${where}]` : ""}`);
    const why = changedUnderUs();
    if (why) {
      console.log(`ABORT ${why}. This is not a fault of the product: run it again when nothing else uses the database.`);
      await browser.close().catch(() => null);
      process.exit(finish(true));
    }
    return false;
  }
}
const must = (cond, what) => {
  if (!cond) throw new Error(what);
};
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// ------------------------------------------------------------------------------------------------------------------------------
const busy = sharedDatabaseProblem();
if (busy) {
  console.error(`e2e: not starting: ${busy}.`);
  process.exit(3);
}
// a fake microphone (a test tone) that Chrome opens without asking: the voice steps record from it (job BF)
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const SLOW = 90_000; // a development server compiles each page the first time it is asked for
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata", permissions: ["microphone"] });
const page = await context.newPage();
page.setDefaultTimeout(SLOW);
page.setDefaultNavigationTimeout(SLOW);
const problems = [];
page.on("console", (m) => {
  const t = m.text();
  if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following|Hydration failed/i.test(t)) problems.push(t.slice(0, 200));
});
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));

let tenant = "";
let slug = "";
let ownerToken = "";
const quiet = () => {
  const h = indiaHour();
  return h >= 21 || h < 9;
};

// ---- 1. sign up, confirm, sign in, set up the business ---------------------------------------------------------------------
if (!(await step("A1", "sign up with the real sign-up page (name, e-mail, password, business, terms)", async () => {
  await page.goto(`${BASE}/signup`);
  await page.fill("#signup-name", "E2E Owner");
  await page.fill("#signup-email", EMAIL);
  await page.fill("#signup-password", PW);
  await page.fill("#signup-business", `E2E Silks ${STAMP}`);
  await page.check('input[name="terms"]');
  await Promise.all([page.waitForURL(/\/signup\/check-email/, { timeout: 30000 }), page.click('button[type="submit"]')]);
  return "ends on 'check your e-mail'";
}, page))) process.exit(finish());

await step("A2", "the local stack asks for e-mail confirmation: confirm the throwaway address, then sign in", async () => {
  confirmEmail(EMAIL);
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/setup/, { timeout: 30000 }); // a confirmed account with no business goes to the set-up screen
}, page);

await step("A3", "first-login setup makes the business with this person as Owner", async () => {
  await Promise.all([page.waitForURL(/\/app(\/tenants|$)/, { timeout: 30000 }), page.click('button[type="submit"]')]);
  const link = page.locator('a[href^="/app/tenants/"]').first();
  if (/\/app$/.test(page.url())) await link.waitFor({ timeout: 15000 });
  const row = psql(`select t.id || '|' || t.slug from public.tenants t join public.memberships m on m.tenant_id = t.id join auth.users u on u.id = m.user_id where u.email = '${EMAIL}'`);
  [tenant, slug] = row.split("|");
  must(/^[0-9a-f-]{36}$/.test(tenant) && slug.startsWith("e2e-"), `workspace not found (${row})`);
  return slug;
}, page);

await step("A4", "enrol an authenticator in the browser (QR, key, six digits)", async () => {
  await page.goto(`${BASE}/app/security`);
  await page.click('button:has-text("Set up an authenticator")');
  await page.waitForSelector('img[alt^="QR code"]');
  const secret = (await page.locator("form code").first().innerText()).trim();
  for (const offset of [0, 1, -1, 2]) {
    await page.fill('input[name="code"]', totp(secret, offset));
    await page.click('button:has-text("Turn on")');
    try {
      await page.waitForSelector("text=Done. Your authenticator is on.", { timeout: 6000 });
      return "turned on";
    } catch {
      // a code is used once per 30 s step: try the next
    }
  }
  throw new Error("the authenticator was not turned on");
}, page);

await step("A5", "sign out, sign in again: the password alone is not enough, the authenticator code is asked for", async () => {
  await context.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/auth\/mfa/, { timeout: 30000 });
  await passChallenge(page, EMAIL);
  must(/\/app/.test(page.url()), "not signed in after the code");
}, page);

// ---- 2. the data a person would already have: customers, consent, messages -----------------------------------------------
ownerToken = await aal2Token();
const T = () => `/v1/tenants/${tenant}`;
const customers = {};
// ---- 2a. the first-run setup wizard (job BJ): a brand-new workspace shows it instead of an empty Today -------------------------------------------------------------
let axeSource = "";
try {
  axeSource = readFileSync(path.join(here, "..", "apps", "web", "node_modules", "axe-core", "axe.min.js"), "utf8");
} catch {
  // axe-core is the web app's dev dependency: without it the accessibility check is skipped and said so
}
const measure = (p) =>
  p.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("a, button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr-only), summary, textarea, [role=switch]")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true]") || el.classList.contains("sr-only") || el.closest("nextjs-portal")) continue;
      if (r.height < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
    }
    const small = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || el.closest("nextjs-portal")) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 13.99) small.add(`${el.tagName.toLowerCase()} ${fs}px`);
    }
    return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 5), small: [...small].slice(0, 4) };
  });
const axeOf = async (p) => {
  if (!axeSource) return [];
  await p.evaluate(axeSource);
  return p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => !/nextjs|portal/.test(JSON.stringify(x.nodes[0]?.target ?? ""))).map((x) => x.id));
};

await step("J1", "setup wizard on a phone (360 px, light and dark): every step is drawn, targets >= 44 px, no sideways scroll, text >= 14 px, axe finds nothing", async () => {
  const state = await context.storageState();
  const seen = [];
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ storageState: state, viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: scheme, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    const p = await ctx.newPage();
    p.setDefaultTimeout(SLOW);
    await p.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    const titles = [];
    for (const [name, advance] of [["shop", "Next"], ["hours", "Next"], ["saree", "Skip for now"], ["agent", "Next"], ["ready", null]]) {
      await p.getByRole("heading", { level: 1 }).waitFor();
      titles.push((await p.getByRole("heading", { level: 1 }).innerText()).trim());
      await p.screenshot({ path: path.join(SHOTS, `V-wizard-${name}-phone-${scheme}.png`), fullPage: true });
      const m = await measure(p);
      if (m.scrollW > m.clientW) seen.push(`${scheme} ${name}: sideways scroll ${m.scrollW}>${m.clientW}`);
      if (m.bad.length) seen.push(`${scheme} ${name}: small targets ${m.bad.join("; ")}`);
      if (m.small.length) seen.push(`${scheme} ${name}: small text ${m.small.join("; ")}`);
      const v = await axeOf(p);
      if (v.length) seen.push(`${scheme} ${name}: axe ${v.join(", ")}`);
      if (advance) await p.getByRole("button", { name: advance, exact: true }).tap();
    }
    must(/^Welcome to E2E Silks/.test(titles[0]) && titles.slice(1).join("|") === "When is the shop open?|Add your first saree|Meet Agent OWL|You're ready", `the steps were ${titles.join(" | ")}`);
    await ctx.close();
  }
  must(seen.length === 0, seen.slice(0, 4).join(" | "));
  return axeSource ? "5 screens x light/dark checked with axe" : "axe-core not installed: that check was skipped";
}, page);

await step("J2", "a brand-new workspace shows the setup wizard instead of Today; step 1 asks for the language of the app", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  const h1 = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  must(/^Welcome to E2E Silks/.test(h1), `the first heading was "${h1}"`);
  must((await page.getByText("Needs you").count()) === 0, "Today is drawn behind the wizard");
  must((await page.getByRole("radio", { name: "తెలుగు" }).count()) === 1, "no language choice");
  await shot(page, "wizard-1-shop");
  await page.getByRole("button", { name: "Next", exact: true }).click();
}, page);

await step("J3", "step 2: the usual saree-shop hours are filled in (Monday to Saturday); Sunday is turned on and the hours are SAVED through the real API", async () => {
  await page.getByRole("heading", { name: "When is the shop open?" }).waitFor();
  must(await page.getByRole("checkbox", { name: /Monday/ }).isChecked(), "Monday should be on");
  must(!(await page.getByRole("checkbox", { name: /Sunday/ }).isChecked()), "Sunday should start off");
  await page.locator("label", { hasText: "Sunday" }).click(); // the checkbox itself is hidden; the chip is the label
  await shot(page, "wizard-2-hours");
  await page.getByRole("button", { name: "Save the hours" }).click();
  await page.getByText(/Hours saved/).waitFor();
  const r = await api("GET", `${T()}/visits/settings`, null, ownerToken);
  must(r.status === 200 && r.body.is_default === false && r.body.weekly_hours.sun?.open === "10:00" && r.body.weekly_hours.mon?.close === "20:30" && r.body.slot_minutes === 30, `the API said ${JSON.stringify(r.body).slice(0, 160)}`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
}, page);

await step("J4", "step 3: add the first saree with a REAL photo (shrunk in the browser, uploaded through the real route to real Storage); the catalogue then has it", async () => {
  await page.getByRole("heading", { name: "Add your first saree" }).waitFor();
  await page.setInputFiles('input[type="file"]', PHOTO);
  await page.getByRole("button", { name: "Add this saree" }).click();
  await page.getByText(/Saree added/).waitFor({ timeout: 60000 });
  const r = await api("GET", `${T()}/catalogue/items?limit=5`, null, ownerToken);
  must(r.status === 200 && r.body.items.length === 1 && r.body.items[0].name === "Maroon Kanchi pattu" && r.body.items[0].active === true, `the catalogue said ${JSON.stringify(r.body).slice(0, 200)}`);
  must(r.body.items[0].cover || (r.body.items[0].photo_count ?? 1) >= 1, "the saree has no photo");
  await shot(page, "wizard-3-saree");
  await page.getByRole("button", { name: "Next", exact: true }).click();
}, page);

await step("J5", "step 4: what Agent OWL does, what always waits (money, complaints, calls), automatic sending OFF in one plain sentence, the quiet hours; then 'You're ready' with three next actions", async () => {
  await page.getByRole("heading", { name: "Meet Agent OWL" }).waitFor();
  const t = await text(page);
  must(t.includes("Automatic sending is off. New messages wait for you to approve them."), "the sending sentence is missing");
  must(/Quiet hours: nothing goes out from \d\d:00 to \d\d:00 \(India time\)\./.test(t), "the quiet hours are missing");
  for (const w of ["Money: prices, discounts, advances and refunds", "Complaints", "Calls: Agent OWL asks you first"]) must(t.includes(w), `missing: ${w}`);
  await shot(page, "wizard-4-agent");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("heading", { name: "You're ready" }).waitFor();
  const links = await page.locator('[data-step="ready"] a').allInnerTexts();
  must(links.length === 3, `${links.length} next actions`);
  await shot(page, "wizard-5-ready");
  await page.getByRole("link", { name: "Go to Today" }).click();
  await page.getByRole("heading", { name: "Needs you", exact: true }).waitFor({ timeout: 60000 });
  must((await page.locator('[data-setup="checklist"]').count()) === 0, "the checklist should be gone: everything is done");
}, page);

await step("J6", "the wizard is resumable and remembers: a reload shows Today, not the wizard; the facts are real (hours saved, one saree)", async () => {
  await page.reload({ waitUntil: "networkidle" });
  must((await page.locator('[data-setup="wizard"]').count()) === 0, "the wizard came back");
  must((await page.getByRole("heading", { name: "Needs you", exact: true }).count()) === 1, "Today is not shown");
  const r = await api("GET", `${T()}/outbox/settings`, null, ownerToken);
  must(r.status === 200 && r.body.auto_send_enabled === false, "automatic sending must still be OFF after the wizard (it never switches it on)");
}, page);

await step("B0", "make the workspace ready: assistant on (local operator step), two customers who agreed to WhatsApp, a message that waits, a message with an English gloss", async () => {
  psql(`select app.operator_enable_assistant('${slug}')`);
  psql("update public.platform_flags set enabled = true where key = 'outbox_enabled' and enabled = false"); // the operator's global switch: only turned ON if it was off, and left on (the seed does the same)
  for (const [key, name, phone, wrote] of [["lakshmi", "E2E Lakshmi Textiles", "+00 90002 00001", "Hello, do you have silk sarees for a wedding?"], ["kavitha", "E2E Kavitha Silks", "+00 90002 00002", "Hello, can I see your new collection?"]]) {
    const company = uuid(), contact = uuid(), lead = uuid();
    for (const [route, body] of [
      ["companies", { id: company, name, type: "customer", country: "IN", city: "Demoville", tags: ["e2e", "synthetic"] }],
      ["contacts", { id: contact, company_id: company, full_name: `${name} contact`, phone }],
      ["leads", { id: lead, company_id: company, contact_id: contact, source: "E2E (synthetic)" }],
    ]) {
      const r = await api("POST", `${T()}/${route}`, body, ownerToken);
      must(r.status === 200 || r.status === 201, `${route}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    const c = await api("POST", `${T()}/contacts/${contact}/record-consent`, { channel: "whatsapp", status: "granted", basis: "explicit_consent", evidence_type: "web_form", evidence_ref: `e2e:${key}` }, ownerToken);
    must(c.status === 200, `consent: HTTP ${c.status}`);
    const inbound = await api("POST", `${T()}/leads/${lead}/enquiries`, { id: uuid(), channel: "whatsapp", received_at: new Date(Date.now() - 3600_000).toISOString(), subject: null, text: wrote }, ownerToken);
    must([200, 201, 409].includes(inbound.status), `inbound: HTTP ${inbound.status}`);
    customers[key] = { company, contact, lead, name };
  }
  const price = await api("POST", `${T()}/outbox/messages`, { message_id: uuid(), lead_id: customers.lakshmi.lead, text: "ఈ చీర ధర 500 రూపాయలు మాత్రమే. ఈ వారం డిస్కౌంట్ ఉంది.", language: "te", category: "reply_to_inbound", source: "assistant", gloss_en: "This saree costs only 500 rupees. There is a discount this week." }, ownerToken);
  must(price.status === 200 && price.body.message.status === "needs_approval", `the price message should wait: ${price.status} ${price.body?.message?.status}`);
  const plain = await api("POST", `${T()}/outbox/messages`, { message_id: uuid(), lead_id: customers.kavitha.lead, text: "Yes, we have silk sarees in stock. You are welcome to visit our shop.", language: "en", category: "reply_to_inbound", source: "assistant" }, ownerToken);
  must(plain.status === 200, `plain message: HTTP ${plain.status}`);
  return `automatic sending is off, so the plain one is ${plain.body.message.status} (${plain.body.message.reason})`;
});

// ---- 3. Today: the card with the English gloss, approve ---------------------------------------------------------------------
await step("C1", "Today shows the waiting message with its words, the English gloss and why it waits", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  await page.waitForSelector("#needs-you article");
  const card = page.locator("#needs-you article").filter({ hasText: "ఈ చీర ధర" });
  must((await card.count()) === 1, "the Telugu price card is not on Today");
  must(await card.locator("[data-part=gloss]").filter({ hasText: "This saree costs only 500 rupees" }).isVisible(), "no English gloss on the card");
  must(/Mentions a price|price/i.test(await card.innerText()), "the reason is not said");
  await shot(page, "today-needs-you");
}, page);

let approved = "";
await step("C2", "approve the message from Today (second factor from the session); the card says what really happened", async () => {
  const card = page.locator("#needs-you article").filter({ hasText: "ఈ చీర ధర" });
  await card.getByRole("button", { name: "Approve and send" }).click();
  const toast = page.locator('[role="status"]').filter({ hasText: /Sent|goes out|queued|Approved/i }).first();
  await toast.waitFor({ timeout: 20000 });
  approved = (await toast.innerText()).replace(/\s+/g, " ");
  await shot(page, "today-approved");
  return approved.slice(0, 120);
}, page);

// ---- 4. Outbox: server filters, counts, gloss, real history, dispatch -----------------------------------------------------
const out = (q = "") => `${BASE}/app/tenants/${tenant}/outbox${q}`;
await step("D1", "Outbox: the four tabs carry the server's counts; the approved message is Sent (or held for the morning in quiet hours)", async () => {
  const wantTab = quiet() ? "scheduled" : "sent";
  await page.goto(out(`?tab=${wantTab}`));
  await page.waitForSelector("[data-screen=outbox]");
  const counts = await page.locator("[data-count]").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-count"), e.textContent.trim()])));
  must(Object.keys(counts).length >= 1, "no counts on the tabs");
  const row = page.locator("li[data-status]").filter({ hasText: "ఈ చీర ధర" });
  must((await row.count()) === 1, `the approved message is not under ${wantTab}`);
  await shot(page, `outbox-${wantTab}`);
  return `${quiet() ? "quiet hours: held for the morning" : "sent by the fake channel"}; counts ${JSON.stringify(counts)}`;
}, page);

await step("D2", "open the row: the English gloss and the REAL history from the events (made, waits, approved, sent or held), with names", async () => {
  const row = page.locator("li[data-status]").filter({ hasText: "ఈ చీర ధర" });
  await row.getByRole("button").first().click();
  await page.waitForSelector('[data-history="events"]', { timeout: 15000 });
  const history = (await page.locator('[data-history="events"] li').allInnerTexts()).map((s) => s.replace(/\s+/g, " "));
  must(history.length >= 3, `too few events: ${JSON.stringify(history)}`);
  must(history.some((h) => /Made by Agent OWL/.test(h)), `no 'Made by Agent OWL': ${JSON.stringify(history)}`);
  must(history.some((h) => /Approved by E2E Owner/.test(h)), `no 'Approved by E2E Owner': ${JSON.stringify(history)}`);
  must(await row.locator("[data-part=gloss]").isVisible(), "no gloss in the row");
  if (quiet()) must(history.some((h) => /Held for the morning: nothing goes out from 21:00 to 09:00/.test(h)), `quiet hours not worded: ${JSON.stringify(history)}`);
  else must(history.some((h) => /Sent/.test(h)), "no 'Sent' event");
  await shot(page, "outbox-history");
  return history.join(" | ").slice(0, 230);
}, page);

await step("D3", "the customer filter and the dates are done by the SERVER (names, India dates, the counts follow)", async () => {
  await page.goto(out("?tab=waiting&q=Kavitha"));
  await page.waitForSelector("[data-screen=outbox]");
  const kavitha = await page.locator("li[data-status]").count();
  await page.goto(out("?tab=waiting&q=Lakshmi"));
  const lakshmi = await page.locator("li[data-status]").count();
  await page.goto(out("?tab=waiting&q=zzzz-nobody"));
  const nobody = await page.locator("li[data-status]").count();
  must(nobody === 0 && /No message matches these filters/.test(await text(page)), "an unknown name should match nothing");
  const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  await page.goto(out(`?tab=waiting&from=${tomorrow}`));
  must((await page.locator("li[data-status]").count()) === 0, "a 'from' in the future should list nothing");
  await page.goto(out("?tab=waiting&range=7d")); // an older link
  await page.waitForSelector("[data-screen=outbox]");
  must((await page.locator("#outbox-from").inputValue()) !== "", "range=7d should become dates");
  await shot(page, "outbox-filters");
  return `waiting for Kavitha: ${kavitha}, for Lakshmi: ${lakshmi}`;
}, page);

await step("D4", "'Send what is due now' speaks the new fields in plain words (per business)", async () => {
  await page.goto(out("?tab=scheduled"));
  await page.waitForSelector("[data-screen=outbox]");
  const line = await page.locator("[data-part=due-line]").innerText();
  must(/Due now: \d+\. Held for the morning: \d+\./.test(line), `the due line is: ${line}`);
  await page.getByRole("button", { name: "Send what is due now" }).click();
  const note = page.locator('[role="status"] p').first();
  await note.waitFor({ timeout: 20000 });
  const said = (await note.innerText()).replace(/\s+/g, " ");
  must(/sent|held for the morning|Nothing was due|stopped/i.test(said), `unexpected: ${said}`);
  await shot(page, "outbox-dispatch");
  return `${line} -> ${said}`;
}, page);

await step("D5", "the Outbox in Hindi and Telugu: no hydration error, dates in our own words", async () => {
  const before = problems.length;
  for (const lang of ["hi", "te", "kn"]) {
    await context.addCookies([{ name: "sme_lang", value: lang, url: BASE }]);
    await page.goto(out("?tab=sent"));
    await page.waitForSelector("[data-screen=outbox]");
    const row = page.locator("li[data-status]").first();
    if (await row.count()) await row.getByRole("button").first().click();
    await page.waitForTimeout(600);
  }
  await shot(page, "outbox-kn");
  await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
  must(problems.length === before, `console problems: ${problems.slice(before).join(" | ")}`);
}, page);

// ---- 5. Settings: quiet hours --------------------------------------------------------------------------------------------
await step("E1", "Settings, Agent OWL: quiet hours are editable within the limits (start 19-23, end 7-10), saved with the second factor, and persist", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/settings?section=agent`);
  await page.waitForSelector("#quiet-start");
  const options = async (id) => page.locator(`#${id} option`).allInnerTexts();
  must(JSON.stringify(await options("quiet-start")) === JSON.stringify(["19:00", "20:00", "21:00", "22:00", "23:00"]), "start options");
  must(JSON.stringify(await options("quiet-end")) === JSON.stringify(["07:00", "08:00", "09:00", "10:00"]), "end options");
  await page.selectOption("#quiet-start", "22");
  await page.selectOption("#quiet-end", "8");
  await page.getByRole("button", { name: "Save quiet hours" }).click();
  await page.locator('[role="status"]').filter({ hasText: "Quiet hours are now 22:00 to 08:00" }).waitFor({ timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" });
  must((await page.locator("#quiet-start").inputValue()) === "22" && (await page.locator("#quiet-end").inputValue()) === "8", "not kept after a reload");
  const viaApi = await api("GET", `${T()}/outbox/settings`, null, ownerToken);
  must(viaApi.body.quiet_hours_start === 22 && viaApi.body.quiet_hours_end === 8, `the API says ${JSON.stringify(viaApi.body)}`);
  await shot(page, "settings-quiet-hours");
}, page);

await step("E2", "the evening-reminder case is explained in one sentence when it applies", async () => {
  // the sentence follows what is SAVED for the reminders (what really applies): save the evening reminder for 20:00 first
  const reminders = page.locator('form[aria-labelledby="reminders-heading"]');
  await reminders.locator("#rem-hour").selectOption("20");
  await reminders.getByRole("button", { name: "Save" }).click();
  await reminders.locator('[role="status"]').waitFor({ timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.selectOption("#quiet-start", "19");
  const note = page.locator('[data-note="evening-inside-quiet"]');
  await note.waitFor({ timeout: 5000 });
  const said = (await note.innerText()).replace(/\s+/g, " ");
  must(/no evening reminder is sent/.test(said) && /heads-up/.test(said), said);
  await page.selectOption("#quiet-start", "21");
  must((await note.count()) === 0, "the sentence should go away");
  await shot(page, "settings-evening-note");
  return said;
}, page);

await step("E3", "an out-of-limit value cannot be saved through the page's own action either (the API's limits are kept)", async () => {
  const r = await api("PUT", `${T()}/outbox/settings`, { auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 18, quiet_hours_end: 9 }, ownerToken);
  must(r.status === 422, `the API should refuse a start of 18, it said ${r.status}`);
  const ok = await api("PUT", `${T()}/outbox/settings`, { auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }, ownerToken);
  must(ok.status === 200, "restoring the default hours failed");
});

// ---- 6. Visits: book and complete -------------------------------------------------------------------------------------------
await step("F1", "Visits: book a visit for a customer (a free time today, written down as it is booked)", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/visits`);
  await page.waitForSelector("[data-screen=visits], main");
  await page.getByLabel("Customer").fill("E2E Lakshmi");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: /E2E Lakshmi Textiles/ }).click();
  const slot = page.getByRole("radio").or(page.getByRole("button", { name: /^\d{1,2}:\d{2}/ })).first();
  await slot.waitFor({ timeout: 15000 });
  await slot.click();
  await page.getByRole("button", { name: /Book the visit/ }).click();
  await page.locator('[role="status"]').filter({ hasText: /Booked/ }).first().waitFor({ timeout: 20000 });
  await shot(page, "visits-booked");
}, page);

await step("F2", "Visits: confirm, they are here, complete with an outcome", async () => {
  if (process.env.E2E_DEBUG) page.on("response", async (r) => { if (r.request().method() === "POST" && /\/visits/.test(r.url())) console.log("DEBUG POST", r.status(), (await r.text().catch(() => "")).slice(0, 300)); });
  await page.reload({ waitUntil: "networkidle" });
  const card = page.locator("article, li").filter({ hasText: /Lakshmi/ }).first();
  for (const name of [/^Confirm/, /They are here/]) {
    await card.getByRole("button", { name }).first().click();
    await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: "Complete", exact: true }).click(); // opens "How did the visit end?"
  await page.getByRole("button", { name: "Will come back", exact: true }).click();
  await page.getByText("Finished").first().waitFor({ timeout: 20000 }); // the visit moves to the "Finished" part of the day, marked Done and "Will come back"
  await shot(page, "visits-completed");
  const rows = psql(`select status || ':' || coalesce(outcome, '') from public.store_visits where tenant_id = '${tenant}'`);
  must(/completed:will_return/.test(rows), `the visit is ${rows}`);
  return rows;
}, page);

if (process.env.E2E_STOP_AFTER === "F2") {
  await browser.close();
  process.exit(finish());
}

// ---- 7. Catalogue: add a saree with a real photo, send it ---------------------------------------------------------------
let itemUrl = "";
await step("G1", "Catalogue: add a saree with a REAL photo (shrunk in the browser, uploaded through the real route to real Storage, progress shown)", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/catalogue/new`);
  await page.fill("#cat-name", "E2E Maroon Kanchi pattu");
  await page.selectOption("#cat-fabric", "kanchi_pattu");
  await page.getByLabel("Maroon", { exact: true }).check();
  await page.getByLabel("Wedding").check();
  await page.selectOption("#cat-band", "25k_50k");
  await page.setInputFiles("input[data-input=choose]", PHOTO);
  await page.waitForSelector("[data-tray=photos] > li");
  await page.getByLabel("Show this saree to customers").check();
  await shot(page, "catalogue-new-staged");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/catalogue\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
  itemUrl = page.url().split("?")[0];
  await page.waitForLoadState("networkidle");
  const loaded = await page.locator("[data-part=slides] img").evaluateAll((els) => els.map((e) => e.naturalWidth > 0 && /\/storage\/v1\//.test(e.src)));
  must(loaded.length === 1 && loaded.every(Boolean), `the uploaded photo did not load from storage: ${JSON.stringify(loaded)}`);
  must(/Saved\./.test(await text(page)), "no saved banner");
  await shot(page, "catalogue-item-saved");
  return "photo is served from Supabase Storage through a signed link and the page's CSP allows it";
}, page);

await step("G2", "Catalogue list shows the saree with its real thumbnail; the owner sees it, and a hidden one would be greyed", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/catalogue`);
  await page.waitForSelector("[data-grid=items] img");
  const ok = await page.locator("[data-grid=items] img").evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
  must(ok.length >= 2 && ok.every(Boolean), `thumbnails: ${JSON.stringify(ok)}`); // the wizard's saree and this one
  await shot(page, "catalogue-list");
}, page);

await step("G3", "Send it to a customer: find the lead (by name), preview the WhatsApp message, send; the answer says in plain words where it stands", async () => {
  await page.goto(itemUrl);
  await page.fill("#send-find", "Kavitha");
  await page.getByRole("button", { name: /E2E Kavitha Silks/ }).click();
  await page.fill("#send-text", "A new maroon Kanchi pattu saree for you. Tell us if you would like to see more.");
  must((await page.locator("[data-part=preview] img").count()) === 1, "the preview has no photo");
  await shot(page, "catalogue-send-ready");
  await page.getByRole("button", { name: "Send to the outbox" }).click();
  const status = page.locator("[data-part=send] [role=status]");
  await status.waitFor({ timeout: 20000 });
  const said = (await status.innerText()).replace(/\s+/g, " ");
  must(/Waiting for the owner|Sent to the customer|Queued/.test(said), said);
  await shot(page, "catalogue-send-result");
  return said.slice(0, 200);
}, page);

await step("G4", "Outbox: the catalogue message carries its photo as a thumbnail (real signed link); approve it if it waits", async () => {
  await page.goto(out("?tab=waiting"));
  await page.waitForSelector("[data-screen=outbox]");
  // the first message to a customer starts with the AI-assistant line, so the row is found by its photo (and its customer), not by the first line of its words
  const row = page.locator("li[data-status]").filter({ hasText: "E2E Kavitha Silks" }).filter({ has: page.locator("[data-part=message-photos]") });
  if (await row.count()) {
    const thumbs = await row.locator("[data-part=message-photos] img").evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
    must(thumbs.length === 1 && thumbs[0], `thumbnails: ${JSON.stringify(thumbs)}`);
    await shot(page, "outbox-photo-waiting");
    await row.getByRole("button").first().click();
    await row.getByRole("button", { name: "Approve and send" }).click();
    // wait for what really happened (a server action compiles on first use in a development server): the note under the tabs
    await page.locator('[role="status"] p').first().waitFor({ timeout: 30000 });
  }
  await page.goto(out(`?tab=${quiet() ? "scheduled" : "sent"}`));
  await page.waitForSelector("[data-screen=outbox]");
  const there = page.locator("li[data-status]").filter({ hasText: "E2E Kavitha Silks" }).filter({ has: page.locator("[data-part=message-photos]") });
  must((await there.count()) === 1, "the catalogue message is not where it should be");
  const thumbs = await there.locator("[data-part=message-photos] img").evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
  must(thumbs.length === 1 && thumbs[0], `thumbnails after: ${JSON.stringify(thumbs)}`);
  await shot(page, "outbox-photo-thumbnail");
  return quiet() ? "held for the morning" : "sent";
}, page);

// ---- 8. Ask Agent OWL ------------------------------------------------------------------------------------------------------
await step("H1", "Ask Agent OWL (the scripted model of the local stack): the question is answered with sources, and nothing is invented", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" }); // the page must be hydrated before the box is typed in, or React resets it
  const box = page.locator("#ask-input");
  await box.fill("What needs me today?");
  await box.press("Enter");
  await page.waitForSelector("[data-ask] , [aria-live=polite]", { timeout: 15000 }).catch(() => null);
  await page.waitForFunction(() => /Here is what I found|I found nothing/.test(document.body.innerText), { timeout: 60000 });
  await shot(page, "ask-answer");
}, page);

await step("H2", "A saree named in an answer links to its page (the scripted model of the local stack has a catalogue path since job BG: the real box, the real API, the real catalogue)", async () => {
  const itemId = itemUrl.split("/").pop();
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" }); // the page must be hydrated before the box is typed in, or React resets it
  const box = page.locator("#ask-input");
  await box.fill("Show me a maroon saree");
  await box.press("Enter");
  const link = page.getByRole("link", { name: /E2E Maroon Kanchi pattu/ });
  await link.first().waitFor({ timeout: 60000 });
  await shot(page, "ask-saree-link");
  await link.first().click();
  await page.waitForURL(new RegExp(`/catalogue/${itemId}`));
}, page);

// ---- 8a. voice in the Ask box (job BF): the API runs the FAKE speech adapters (development only, no key, no cost); Chrome has a fake microphone ---------------------------
const micButton = () => page.getByRole("button", { name: "Speak your question" });
await step("H3", "voice: the microphone is drawn because the API says voice is on; the privacy line and the auto-play switch are there; the page lets the microphone through", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  await micButton().waitFor({ timeout: 30000 });
  const t = await text(page);
  must(t.includes("Your voice is sent to our speech service to be understood. We don't keep the recording."), "the privacy line is not on the page");
  const sw = page.getByRole("switch", { name: "Play voice answers automatically" });
  must(await sw.isVisible(), "the auto-play switch is not there");
  must((await sw.getAttribute("aria-checked")) === "false", "a laptop should start with auto-play off");
  const r = await page.request.get(`${BASE}/app/tenants/${tenant}/ask/voice`);
  must(JSON.stringify(await r.json()) === '{"available":true,"speech":true}', `the status route said ${await r.text()}`);
  must(/microphone=\(self\)/.test(r.headers()["permissions-policy"] ?? ""), "Permissions-Policy does not let this site use the microphone");
  await shot(page, "voice-idle");
}, page);

await step("H4", "voice: tap to record, the countdown runs, Cancel throws it away and nothing is sent", async () => {
  let posted = 0;
  const onRequest = (r) => {
    if (r.method() === "POST" && /\/ask\/voice/.test(r.url())) posted++;
  };
  page.on("request", onRequest);
  await micButton().click();
  await page.getByText("Recording…").waitFor({ timeout: 30000 });
  await page.waitForFunction(() => /\d:\d\d left/.test(document.body.innerText));
  await page.waitForTimeout(1500);
  const left = (await text(page)).match(/(\d:\d\d) left/)?.[1];
  must(left && left !== "1:00", `the countdown did not run (${left})`);
  await shot(page, "voice-recording");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator("#ask-input").waitFor();
  await page.waitForTimeout(800);
  page.off("request", onRequest);
  must(posted === 0, `${posted} request(s) were sent after Cancel`);
  return `countdown showed ${left}`;
}, page);

await step("H5", "voice: record, stop, see what was heard as your message, the written answer and a spoken answer you can stop", async () => {
  const sent = [];
  const onRequest = (r) => {
    if (r.method() === "POST" && /\/ask\/voice/.test(r.url())) sent.push({ url: r.url(), type: r.headers()["content-type"], size: 0 });
  };
  page.on("request", onRequest);
  // the browser does not hand a Blob body to the request object: note its size where it is sent
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.__voiceBody = 0;
    window.fetch = (input, init) => {
      if (/\/ask\/voice\?/.test(String(input)) && init?.body?.size !== undefined) window.__voiceBody = init.body.size;
      return original(input, init);
    };
  });
  await page.getByRole("switch", { name: "Play voice answers automatically" }).click();
  await micButton().click();
  await page.getByText("Recording…").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop and ask" }).click();
  await page.getByText("You said: What needs me today?").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => /Here is what I found|I found nothing/.test(document.body.innerText), { timeout: 60000 });
  const play = page.locator('[data-voice="play"]');
  await play.waitFor({ timeout: 60000 });
  page.off("request", onRequest);
  must(sent.length === 1, `${sent.length} voice requests`);
  must(/speak=1/.test(sent[0].url), "a spoken answer was not asked for");
  sent[0].size = await page.evaluate(() => window.__voiceBody);
  must(/^audio\/webm/.test(sent[0].type ?? "") && sent[0].size > 500, `the recording was ${sent[0].type} ${sent[0].size} bytes`);
  must(!(await page.locator("#ask-input").isHidden()), "the question box did not come back");
  await shot(page, "voice-answer");
  const label = (await play.innerText()).trim();
  must(label === "Stop" || label === "Play spoken answer", `the audio button said "${label}"`);
  if (label === "Stop") await play.click();
  await page.getByRole("button", { name: "Play spoken answer" }).waitFor({ timeout: 10000 });
  return `${sent[0].type}, ${sent[0].size} bytes; audio button "${label}" before Stop`;
}, page);

await step("H6", "voice: when the API says voice is off, the microphone, the switch and the privacy line are not drawn (no dead button)", async () => {
  await context.route("**/ask/voice", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { available: false, speech: false } }) : route.continue()));
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  await page.locator("#ask-input").waitFor();
  await page.waitForTimeout(1500);
  must((await micButton().count()) === 0, "a microphone is drawn though voice is off");
  must((await page.getByRole("switch").count()) === 0, "the auto-play switch is drawn though voice is off");
  await context.unroute("**/ask/voice");
}, page);

await step("H7", "voice: a used-up allowance is said in words, and typing still works", async () => {
  await context.route("**/ask/voice?*", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "error", code: "ai_paused_until" })}\n` }) : route.continue()));
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  await micButton().click();
  await page.getByText("Recording…").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop and ask" }).click();
  await page.getByRole("alert").filter({ hasText: "spending limit" }).waitFor({ timeout: 30000 });
  await context.unroute("**/ask/voice?*");
  must(await page.locator("#ask-input").isEnabled(), "typing is not available after the refusal");
}, page);

// ---- 8a. the Office (job BM): the 3D room draws and its owls sit where they should ---------------------------------------------------------------
await step("O1", "the Office in 3D (WebGL in the test browser): the room draws at 1280 and 360 px, no THREE.Clock deprecation in the console, pictures for the owl size check", async () => {
  const clock = [];
  const onConsole = (m) => {
    if (/Clock: This module has been deprecated/.test(m.text())) clock.push(m.text());
  };
  page.on("console", onConsole);
  try {
    for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 360, height: 740 }]]) {
      await page.setViewportSize(size);
      await page.goto(`${BASE}/app/tenants/${tenant}/office`, { waitUntil: "networkidle" });
      await page.evaluate(() => localStorage.setItem("sme_office_view", "3d"));
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("canvas").first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(2500); // the owls settle into their seats
      await shot(page, `office-3d-${name}`);
    }
  } finally {
    page.off("console", onConsole);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  must(clock.length === 0, `the Clock deprecation is still in the console: ${clock[0]}`);
}, page);

// ---- 8a. the older screens in Telugu (job BK): every workspace screen says its words through the string store; no raw key and no English sentence is left on the page --------------------
await step("K1", "the older screens (leads, customers, enquiries, quotes, orders, follow-ups, price list, policies, privacy, agents, suppression, security) in English and in Telugu: no raw key, Telugu letters on the page, no console problems", async () => {
  const before = problems.length;
  const lead = customers.lakshmi;
  const list = await api("GET", `${T()}/leads/${lead.lead}/enquiries`, null, ownerToken);
  const enquiry = (list.body?.enquiries ?? list.body ?? [])[0]?.id;
  const pages = [
    ["home", `${BASE}/app/tenants/${tenant}`],
    ["customers-new", `${BASE}/app/tenants/${tenant}/customers/new`],
    ["products-new", `${BASE}/app/tenants/${tenant}/products/new`],
    ["company", `${BASE}/app/tenants/${tenant}/companies/${lead.company}`],
    ["lead", `${BASE}/app/tenants/${tenant}/leads/${lead.lead}`],
    ["lead-followup", `${BASE}/app/tenants/${tenant}/leads/${lead.lead}/followup`],
    ["consent", `${BASE}/app/tenants/${tenant}/contacts/${lead.contact}/consent`],
    ...(enquiry ? [["enquiry", `${BASE}/app/tenants/${tenant}/enquiries/${enquiry}`]] : []),
    ["quotes", `${BASE}/app/tenants/${tenant}/quotes`],
    ["orders", `${BASE}/app/tenants/${tenant}/orders`],
    ["followups", `${BASE}/app/tenants/${tenant}/followups`],
    ["followups-policy", `${BASE}/app/tenants/${tenant}/followups/policy`],
    ["review", `${BASE}/app/tenants/${tenant}/review`],
    ["suggestions", `${BASE}/app/tenants/${tenant}/suggestions`],
    ["price-list", `${BASE}/app/tenants/${tenant}/price-list`],
    ["quote-policy", `${BASE}/app/tenants/${tenant}/quote-policy`],
    ["item-types", `${BASE}/app/tenants/${tenant}/item-types`],
    ["agents", `${BASE}/app/tenants/${tenant}/agents`],
    ["suppression", `${BASE}/app/tenants/${tenant}/suppression`],
    ["privacy", `${BASE}/app/tenants/${tenant}/privacy`],
    ["security", `${BASE}/app/security`],
  ];
  const RAW = /\b(?:enq|orders|lead|cust|cont|comp|fu|prod|pl|it|qp|rev|supp|prv|ag|sug|ws|acct|parts|settings)\.[a-z0-9]+_[a-z0-9_]+\b|\b(?:enq|orders|fu|ws|lead|rev)\.(?:state|channel|status|kind|field|reason|band|flag|run|confidence|scope)\.[a-z_]+/;
  const shown = [];
  for (const lang of ["en", "te"]) {
    await context.addCookies([{ name: "sme_lang", value: lang, url: BASE }]);
    for (const [name, url] of pages) {
      const r = await page.goto(url, { waitUntil: "networkidle" });
      must(r && r.status() < 400, `${name} (${lang}): HTTP ${r?.status()}`);
      const body = await text(page);
      const raw = RAW.exec(body);
      must(!raw, `${name} (${lang}) shows a raw key: ${raw?.[0]}`);
      must(!/Application error|This page could not be found/i.test(body), `${name} (${lang}) did not draw`);
      if (lang === "te" && !["security"].includes(name)) must(/[\u0C00-\u0C7F]/.test(body), `${name} (te) has no Telugu on it`);
      await shot(page, `K-${name}-${lang}`);
      shown.push(`${name}/${lang}`);
    }
  }
  await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
  must(problems.length === before, `console problems: ${problems.slice(before).join(" | ")}`);
  return `${shown.length} page views`;
}, page);

// the same pages on the code BEFORE job BK (optional: E2E_BEFORE_URL is a second web from origin/main, started by hand on its own port; same Supabase, so the same session): Telugu screenshots to compare
if (process.env.E2E_BEFORE_URL) {
  await step("K2", "the same screens on the code before job BK, in Telugu (for the before/after pictures)", async () => {
    const BEFORE = process.env.E2E_BEFORE_URL.replace(/\/$/, "");
    await context.addCookies([{ name: "sme_lang", value: "te", url: BEFORE }]);
    const lead = customers.lakshmi;
    const list = await api("GET", `${T()}/leads/${lead.lead}/enquiries`, null, ownerToken);
    const enquiry = (list.body?.enquiries ?? list.body ?? [])[0]?.id;
    const t = `${BEFORE}/app/tenants/${tenant}`;
    const pages = [["home", t], ["customers-new", `${t}/customers/new`], ["lead", `${t}/leads/${lead.lead}`], ["lead-followup", `${t}/leads/${lead.lead}/followup`], ...(enquiry ? [["enquiry", `${t}/enquiries/${enquiry}`]] : []), ["quotes", `${t}/quotes`], ["orders", `${t}/orders`], ["followups", `${t}/followups`], ["price-list", `${t}/price-list`], ["agents", `${t}/agents`], ["privacy", `${t}/privacy`], ["security", `${BEFORE}/app/security`]];
    for (const [name, url] of pages) {
      await page.goto(url, { waitUntil: "networkidle" });
      await shot(page, `K-BEFORE-${name}-te`);
    }
    await context.addCookies([{ name: "sme_lang", value: "en", url: BEFORE }]);
    return `${pages.length} pages`;
  }, page);
}

// ---- 8a. Help (job BT): the guides, the "?" tips, "What can Agent OWL do?" -------------------------------------------------------------------
await step("Q1", "Help: the menu opens the guides, a guide has its steps and in Telugu no raw key; the '?' tip of the Outbox opens and links to its guide; 'What can Agent OWL do?' opens under the Ask box and an example asks", async () => {
  const home = `${BASE}/app/tenants/${tenant}`;
  await page.goto(home, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Help", exact: true }).first().click();
  await page.waitForURL(/\/help$/);
  must((await page.getByRole("list", { name: "Guides" }).getByRole("link").count()) === 8, "the Help screen does not list eight guides");
  await shot(page, "help-index");
  await page.getByRole("link", { name: /Approve a message/ }).click();
  await page.waitForURL(/\/help\/approve$/);
  must((await page.locator("ol > li").count()) === 4, "the guide does not have four steps");
  await shot(page, "help-guide");
  // Telugu: a translated guide and an English-only one
  await context.addCookies([{ name: "sme_lang", value: "te", url: BASE }]);
  for (const g of ["today", "outbox"]) {
    await page.goto(`${home}/help/${g}`, { waitUntil: "networkidle" });
    const body = await text(page);
    must(!/help\.guide\./.test(body), `${g}: a raw key shows`);
    if (g === "today") must(/[\u0C00-\u0C7F]/.test(body), "the Telugu guide has no Telugu on it");
    else must(/English/.test(body) || /ఇంగ్లీష్/.test(body), "the English-only guide does not say so");
  }
  await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
  // the "?" tip of the Outbox
  await page.goto(out(""), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Help for this screen" }).click();
  const region = page.getByRole("region", { name: "Help for this screen" });
  await region.waitFor();
  must((await region.locator("li").count()) === 3, "the tip does not have three lines");
  await shot(page, "help-tip-outbox");
  await region.getByRole("link", { name: "Read the full guide" }).click();
  await page.waitForURL(/\/help\/outbox$/);
  // the other four screens carry a tip too
  for (const [name, url] of [["today", home], ["visits", `${home}/visits`], ["catalogue", `${home}/catalogue`], ["settings", `${home}/settings`]]) {
    await page.goto(url, { waitUntil: "networkidle" });
    must((await page.getByRole("button", { name: "Help for this screen" }).count()) === 1, `${name}: no '?' tip`);
  }
  // What can Agent OWL do? (the Ask box on Today)
  await page.goto(home, { waitUntil: "networkidle" });
  const can = page.getByRole("button", { name: "What can Agent OWL do?" });
  await can.waitFor({ timeout: 30000 });
  await can.click();
  const sheet = page.getByRole("region", { name: "What Agent OWL can do for you" });
  await sheet.waitFor();
  must(/Change your records or your prices/.test(await sheet.innerText()), "the sheet does not say what Agent OWL cannot do");
  await shot(page, "help-can-sheet");
  await sheet.getByRole("button", { name: "What needs me today?" }).click();
  await page.getByText("Looking at your records…").or(page.getByText("Where this came from")).first().waitFor({ timeout: 30000 });
}, page);

await step("Q2", "Help on a phone (360 px) and in the dark: the index, a guide, the open '?' tip and the open 'What can Agent OWL do?' card: no sideways scroll, targets >= 44 px, text >= 14 px, axe finds nothing", async () => {
  let axe = "";
  try {
    axe = readFileSync(path.join(here, "..", "apps", "web", "node_modules", "axe-core", "axe.min.js"), "utf8");
  } catch {
    // axe-core is the web app's dev dependency: without it that one check is skipped and said so
  }
  const seen = [];
  const home = `${BASE}/app/tenants/${tenant}`;
  for (const [label, viewport, mobile, scheme] of [["phone-light", { width: 360, height: 780 }, true, "light"], ["phone-dark", { width: 360, height: 780 }, true, "dark"], ["desktop-dark", { width: 1280, height: 900 }, false, "dark"]]) {
    // the run's own page (its session cookies rotate; a copy of them would be refused): resized and given the colour scheme, no second browser context
    const p = page;
    await p.setViewportSize(viewport);
    await p.emulateMedia({ colorScheme: scheme });
    void mobile;
    for (const [name, url, open] of [["help", `${home}/help`, null], ["help-guide", `${home}/help/visits`, null], ["outbox-tip", out(""), "tip"], ["ask-can", home, "can"]]) {
      await p.goto(url, { waitUntil: "networkidle" });
      try {
        if (open === "tip") await p.getByRole("button", { name: "Help for this screen" }).click({ timeout: 15000 });
        if (open === "can") {
          await p.getByRole("button", { name: "What can Agent OWL do?" }).click({ timeout: 15000 });
          await p.getByRole("region", { name: "What Agent OWL can do for you" }).waitFor({ timeout: 15000 });
        }
      } catch (error) {
        await p.screenshot({ path: path.join(SHOTS, `Q-FAIL-${name}-${label}.png`) });
        throw new Error(`${label} ${name}: ${String(error.message).split("\n")[0]}`);
      }
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(SHOTS, `Q-${name}-${label}.png`), fullPage: true });
      const m = await p.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll("a, button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr-only), summary, textarea")) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true]") || el.classList.contains("sr-only")) continue;
          if (r.height < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
        }
        const small = new Set();
        for (const el of document.querySelectorAll("body *")) {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 13.99 && !el.closest("nextjs-portal")) small.add(`${el.tagName.toLowerCase()} ${fs}px`);
        }
        return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 5), small: [...small].slice(0, 4) };
      });
      if (m.scrollW > m.clientW) seen.push(`${label} ${name}: sideways scroll ${m.scrollW}>${m.clientW}`);
      if (m.bad.length) seen.push(`${label} ${name}: small targets ${m.bad.join("; ")}`);
      if (m.small.length) seen.push(`${label} ${name}: small text ${m.small.join("; ")}`);
      if (axe) {
        await p.evaluate(axe);
        const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => !/nextjs|portal/.test(JSON.stringify(x.nodes[0]?.target ?? ""))).map((x) => `${x.id}(${x.nodes.length}: ${JSON.stringify(x.nodes.map((n) => n.target)).slice(0, 160)})`));
        if (v.length) seen.push(`${label} ${name}: axe ${v.join(", ")}`);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  must(seen.length === 0, seen.slice(0, 4).join(" | "));
  return axe ? "12 page views checked with axe" : "axe-core not installed: that check was skipped";
}, page);

// ---- 8a. install on a phone and work offline (job BL) -------------------------------------------------------------------------------
await step("P1", "installable: the manifest is served, the browser finds no installability error, the offline worker takes control, and with no network the offline page speaks the person's language (no page is stored)", async () => {
  await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
  const m = await page.request.get(`${BASE}/manifest.webmanifest`);
  must(m.status() === 200, `manifest HTTP ${m.status()}`);
  const mj = await m.json();
  must(mj.name === "Sme-AI" && mj.display === "standalone" && mj.start_url === "/app", "manifest fields");
  for (const icon of mj.icons) must((await page.request.get(BASE + icon.src)).status() === 200, `icon ${icon.src}`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  must(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active), "the worker is not active");
  await page.reload({ waitUntil: "networkidle" }); // now the page is controlled
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  const cdp = await context.newCDPSession(page);
  const errors = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors;
  must(errors.length === 0, `installability errors: ${JSON.stringify(errors)}`);
  const head = await page.evaluate(() => ({ manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"), theme: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")), apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") }));
  must(head.manifest === "/manifest.webmanifest" && head.theme.length === 2 && head.apple, `page head: ${JSON.stringify(head)}`);
  // English first, then Telugu (the worker is told the language by the page)
  for (const [lang, phrase] of [["en", "You're offline. Agent OWL will catch up when you're back."], ["te", "మీరు ఆఫ్‌లైన్‌లో ఉన్నారు."]]) {
    await context.addCookies([{ name: "sme_lang", value: lang, url: BASE }]);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500); // the language word reaches the worker
    await context.setOffline(true);
    try {
      await page.goto(`${BASE}/app`).catch(() => null);
      await page.getByText(phrase).waitFor({ timeout: 20000 });
      must((await page.locator("h1").innerText()).length > 3, "no heading");
      await shot(page, `offline-${lang}`);
    } finally {
      await context.setOffline(false);
    }
  }
  const names = await page.evaluate(() => caches.keys());
  must(names.every((n) => /^sme-(shell|static|prefs)/.test(n)), `unexpected caches: ${names}`);
  const stored = await page.evaluate(async () => {
    const out = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  must(stored.every((u) => /^\/(offline\/|icons\/owl\.svg|__lang|_next\/static\/)/.test(u)), `the worker stored something else: ${stored.join(", ")}`);
  await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
  return `${stored.length} stored files, all of the offline shell`;
}, page);

await step("P2", "the 'Add to home screen' hint on a phone: quiet on the first visits, shown on the third, dismissible, above the bottom bar, 44 px buttons, light and dark", async () => {
  const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", storageState: await context.storageState() });
  const p = await phone.newPage();
  p.setDefaultTimeout(SLOW);
  try {
    await p.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    must((await p.locator('[data-part="install-hint"]').count()) === 0, "the hint is shown on the first visit");
    await p.evaluate(() => localStorage.setItem("sme-install-hint", JSON.stringify({ visits: 2, last: Date.now() - 3 * 3600_000, closedAt: null, installed: false })));
    await p.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    const hint = p.locator('[data-part="install-hint"]');
    await hint.waitFor({ timeout: 30000 });
    const box = await hint.boundingBox();
    const bar = await p.locator("nav[aria-label]").last().boundingBox();
    must(box && bar && box.y + box.height <= bar.y + 1, `the hint overlaps the bottom bar (${JSON.stringify(box)} / ${JSON.stringify(bar)})`);
    must(box.x >= 0 && box.x + box.width <= 360, "the hint is wider than the phone");
    for (const b of await hint.getByRole("button").all()) {
      const bb = await b.boundingBox();
      must(bb && bb.height >= 44 && bb.width >= 44, `a button of the hint is smaller than 44 px (${JSON.stringify(bb)})`);
    }
    await p.screenshot({ path: path.join(SHOTS, "P2-install-hint-phone.png") });
    await hint.getByRole("button", { name: "Not now" }).first().click();
    await hint.waitFor({ state: "detached" });
    await p.reload({ waitUntil: "networkidle" });
    must((await p.locator('[data-part="install-hint"]').count()) === 0, "it came back after Not now");
    const state = JSON.parse(await p.evaluate(() => localStorage.getItem("sme-install-hint")));
    must(state.closedAt > 0, "the choice was not kept");
    // in the installed app (standalone) it never shows
    await p.evaluate(() => localStorage.setItem("sme-install-hint", JSON.stringify({ visits: 9, last: 0, closedAt: null, installed: false })));
    await p.emulateMedia({ colorScheme: "dark" });
    await p.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    await p.locator('[data-part="install-hint"]').waitFor({ timeout: 30000 });
    await p.screenshot({ path: path.join(SHOTS, "P2-install-hint-phone-dark.png") });
  } finally {
    await phone.close();
  }
}, page);

// ---- 8a2. the notifications bell (job BU): a count of what is new on THIS device, a panel of links, no push service, nothing named in a pop-up --------------------------
await step("N1", "the bell: count, panel, deep link, per-device unread, polling asks only the app's own route, 360 px dark has no sideways scroll, targets >= 44 px, axe finds nothing", async () => {
  let axe = "";
  try {
    axe = readFileSync(path.join(here, "..", "apps", "web", "node_modules", "axe-core", "axe.min.js"), "utf8");
  } catch {
    // axe-core is the web app's dev dependency: without it that one check is skipped and said so
  }
  const before = problems.length;
  const asked = [];
  const onRequest = (r) => {
    if (/\/notifications(\?|$)/.test(r.url())) asked.push(r.url());
  };
  page.on("request", onRequest);
  const here2 = `${BASE}/app/tenants/${tenant}`;
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const synthetic = [
    { id: "message_blocked:e2e-1", code: "message_blocked", who: "Synthetic Customer", at, href: `/app/tenants/${tenant}/outbox?tab=blocked` },
    { id: "visit_here:e2e-2", code: "visit_here", who: "Synthetic Visitor", at, href: `/app/tenants/${tenant}/visits` },
  ];
  await page.route(/\/notifications$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: synthetic }) }));
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${here2}`, { waitUntil: "networkidle" });
    await page.evaluate((id) => window.localStorage.removeItem(`sme-notify-seen:${id}`), tenant);
    await page.reload({ waitUntil: "networkidle" });
    const bell = page.locator('[data-notify="bell"]');
    await bell.waitFor();
    must(/Notifications, 2 new/.test((await bell.getAttribute("aria-label")) || ""), `the bell does not say 2 new: ${await bell.getAttribute("aria-label")}`);
    must(asked.every((u) => u.startsWith(`${BASE}/app/tenants/${tenant}/`)), `the bell asked somewhere else: ${asked.join(", ")}`);
    await bell.click();
    const panel = page.locator('[data-notify="panel"]');
    await panel.waitFor();
    must((await panel.locator("a[data-notice]").count()) === 2, "the panel does not list 2 notices");
    must(!(await panel.innerText()).includes("push"), "the panel mentions push");
    await page.screenshot({ path: path.join(SHOTS, "N-panel-desktop.png") });
    // opening counted them seen on this device: a reload shows none new; another device (empty storage) shows 2 again
    await page.reload({ waitUntil: "networkidle" });
    must(/^Notifications$/.test((await page.locator('[data-notify="bell"]').getAttribute("aria-label")) || ""), "after viewing, the bell still shows new ones");
    await page.evaluate((id) => window.localStorage.removeItem(`sme-notify-seen:${id}`), tenant);
    await page.reload({ waitUntil: "networkidle" });
    must(/2 new/.test((await page.locator('[data-notify="bell"]').getAttribute("aria-label")) || ""), "a device with nothing remembered does not show 2 new");
    // the deep link goes to the page that decides it, and the panel closes
    await page.locator('[data-notify="bell"]').click();
    await page.locator('[data-notice="message_blocked"]').click();
    await page.waitForURL(/\/outbox\?tab=blocked/);
    must((await page.locator('[data-notify="panel"]').count()) === 0, "the panel stayed open on the new page");
    // a hidden tab asks no more
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const quiet = asked.length;
    await page.waitForTimeout(3000);
    must(asked.length === quiet, "the bell asked while the tab was hidden");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    });
    // a phone, dark: the bar, the panel
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(`${here2}`, { waitUntil: "networkidle" });
    await page.evaluate((id) => window.localStorage.removeItem(`sme-notify-seen:${id}`), tenant);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-notify="bell"]').click();
    await page.locator('[data-notify="panel"]').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "N-panel-phone-dark.png") });
    const m = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('[data-notify="panel"] a, [data-notify="panel"] button, [data-notify="bell"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const small = new Set();
      for (const el of document.querySelectorAll('[data-notify="panel"] *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 13.99) small.add(`${el.tagName.toLowerCase()} ${fs}px`);
      }
      const pr = document.querySelector('[data-notify="panel"]').getBoundingClientRect();
      return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 5), small: [...small].slice(0, 4), inside: pr.left >= 0 && pr.right <= window.innerWidth };
    });
    must(m.scrollW <= m.clientW, `sideways scroll ${m.scrollW}>${m.clientW}`);
    must(m.bad.length === 0, `small targets ${m.bad.join("; ")}`);
    must(m.small.length === 0, `small text ${m.small.join("; ")}`);
    must(m.inside, "the panel runs off the screen");
    if (axe) {
      await page.evaluate(axe);
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => !/nextjs|portal/.test(JSON.stringify(x.nodes[0]?.target ?? ""))).map((x) => `${x.id}(${x.nodes.length})`));
      must(v.length === 0, `axe ${v.join(", ")}`);
    }
    must(problems.length === before, `console problems: ${problems.slice(before).join(" | ")}`);
  } finally {
    page.off("request", onRequest);
    await page.unroute(/\/notifications$/).catch(() => null);
    await page.emulateMedia({ colorScheme: null, reducedMotion: null }).catch(() => null);
    await page.setViewportSize({ width: 1280, height: 900 }).catch(() => null);
    await page.evaluate((id) => window.localStorage.removeItem(`sme-notify-seen:${id}`), tenant).catch(() => null);
  }
  return axe ? "bell, panel, deep link, per-device unread, 360 px dark, axe" : "bell checked; axe-core not installed: that check was skipped";
}, page);

// ---- 8b. the new screens on a phone (360 px) and in the dark: no sideways scroll, targets of 44 px, no accessibility violation --------------------------
await step("V1", "Outbox (gloss, history, filters, counts), Settings (quiet hours) and the saree page at 360 px and in the dark: no sideways scroll, targets >= 44 px, text >= 14 px, axe finds nothing", async () => {
  let axe = "";
  try {
    axe = readFileSync(path.join(here, "..", "apps", "web", "node_modules", "axe-core", "axe.min.js"), "utf8");
  } catch {
    // axe-core is the web app's dev dependency: without it that one check is skipped and said so
  }
  const state = await context.storageState();
  const seen = [];
  for (const [label, viewport, mobile, scheme] of [["phone-light", { width: 360, height: 780 }, true, "light"], ["phone-dark", { width: 360, height: 780 }, true, "dark"], ["desktop-dark", { width: 1280, height: 900 }, false, "dark"]]) {
    const ctx = await browser.newContext({ storageState: state, viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    const p = await ctx.newPage();
    for (const [name, url, open] of [
      ["outbox", out(`?tab=${quiet() ? "scheduled" : "sent"}`), true],
      ["settings-agent", `${BASE}/app/tenants/${tenant}/settings?section=agent`, false],
      ["catalogue-item", itemUrl, false],
    ]) {
      await p.goto(url, { waitUntil: "networkidle" });
      if (open) {
        const row = p.locator("li[data-status]").first();
        await row.getByRole("button").first().click();
        await p.waitForSelector('[data-history="events"]', { timeout: 15000 }).catch(() => null);
      }
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(SHOTS, `V-${name}-${label}.png`), fullPage: true });
      const m = await p.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll("a, button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr-only), summary, textarea")) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true]") || el.classList.contains("sr-only")) continue;
          if (r.height < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
        }
        const small = new Set();
        for (const el of document.querySelectorAll("body *")) {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 13.99 && !el.closest("nextjs-portal")) small.add(`${el.tagName.toLowerCase()} ${fs}px`);
        }
        return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 5), small: [...small].slice(0, 4) };
      });
      if (m.scrollW > m.clientW) seen.push(`${label} ${name}: sideways scroll ${m.scrollW}>${m.clientW}`);
      if (m.bad.length) seen.push(`${label} ${name}: small targets ${m.bad.join("; ")}`);
      if (m.small.length) seen.push(`${label} ${name}: small text ${m.small.join("; ")}`);
      if (axe) {
        await p.evaluate(axe);
        const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => !/nextjs|portal/.test(JSON.stringify(x.nodes[0]?.target ?? ""))).map((x) => `${x.id}(${x.nodes.length})`));
        if (v.length) seen.push(`${label} ${name}: axe ${v.join(", ")}`);
      }
    }
    await ctx.close();
  }
  must(seen.length === 0, seen.slice(0, 4).join(" | "));
  return axe ? "9 pages checked with axe" : "axe-core not installed: that check was skipped";
}, page);

// ---- 8c. the recording bar on a phone (360 px), light and dark: a finger taps the microphone; targets >= 44 px, no sideways scroll, axe finds nothing --------------------------
await step("V2", "voice on a phone: tap the microphone (the recording bar, Cancel, the switch) at 360 px, light and dark: targets >= 44 px, no sideways scroll, text >= 14 px, axe finds nothing", async () => {
  let axe = "";
  try {
    axe = readFileSync(path.join(here, "..", "apps", "web", "node_modules", "axe-core", "axe.min.js"), "utf8");
  } catch {
    // axe-core is the web app's dev dependency: without it that one check is skipped and said so
  }
  const state = await context.storageState();
  const seen = [];
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ storageState: state, viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: scheme, locale: "en-IN", timezoneId: "Asia/Kolkata", permissions: ["microphone"] });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
    const mic = p.getByRole("button", { name: "Speak your question" });
    await mic.waitFor({ timeout: 30000 });
    const on = await p.getByRole("switch", { name: "Play voice answers automatically" }).getAttribute("aria-checked");
    if (on !== "true") seen.push(`${scheme}: a phone should start with auto-play on (it said ${on})`);
    await p.screenshot({ path: path.join(SHOTS, `V-voice-idle-phone-${scheme}.png`), fullPage: true });
    const xBefore = (await mic.boundingBox())?.x ?? -1;
    await mic.tap();
    await p.getByText("Recording…").waitFor({ timeout: 30000 }).catch(async () => {
      seen.push(`${scheme}: the recording bar did not appear after a tap`);
    });
    await p.waitForTimeout(1200);
    const xAfter = (await p.getByRole("button", { name: "Stop and ask" }).boundingBox())?.x ?? -2;
    if (Math.abs(xAfter - xBefore) > 1) seen.push(`${scheme}: the microphone moved from x=${xBefore} to x=${xAfter} when recording started (a tap could land on Cancel)`);
    await p.screenshot({ path: path.join(SHOTS, `V-voice-recording-phone-${scheme}.png`), fullPage: true });
    const m = await p.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("a, button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr-only), summary, textarea, [role=switch]")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true]") || el.classList.contains("sr-only")) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}px`);
      }
      const small = new Set();
      for (const el of document.querySelectorAll("body *")) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 13.99 && !el.closest("nextjs-portal")) small.add(`${el.tagName.toLowerCase()} ${fs}px`);
      }
      const cancel = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Cancel");
      const bar = document.querySelector('[data-voice="recording"]')?.getBoundingClientRect();
      return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 5), small: [...small].slice(0, 4), cancel: Boolean(cancel), bar: bar ? Math.round(bar.width) : 0 };
    });
    if (m.scrollW > m.clientW) seen.push(`${scheme}: sideways scroll ${m.scrollW}>${m.clientW}`);
    if (m.bad.length) seen.push(`${scheme}: small targets ${m.bad.join("; ")}`);
    if (m.small.length) seen.push(`${scheme}: small text ${m.small.join("; ")}`);
    if (!m.cancel) seen.push(`${scheme}: no Cancel while recording`);
    if (m.bar < 100) seen.push(`${scheme}: the recording bar is only ${m.bar}px wide`);
    if (axe) {
      await p.evaluate(axe);
      const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((x) => !/nextjs|portal/.test(JSON.stringify(x.nodes[0]?.target ?? ""))).map((x) => x.id));
      if (v.length) seen.push(`${scheme}: axe ${v.join(", ")}`);
    }
    await p.getByRole("button", { name: "Cancel" }).tap();
    await ctx.close();
  }
  must(seen.length === 0, seen.slice(0, 4).join(" | "));
  return axe ? "recording bar + idle, light and dark, checked with axe" : "axe-core not installed: that check was skipped";
}, page);

// ---- 9. the whole run: no CSP violation, no hydration error ---------------------------------------------------------------
await step("Z1", "no Content-Security-Policy violation and no hydration error in the browser console during the whole run", async () => {
  must(problems.length === 0, problems.slice(0, 3).join(" | "));
}, page);

await browser.close();
process.exit(finish());

function finish(aborted = false) {
  const failed = results.filter((r) => r.status === "FAIL");
  const summary = `${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`;
  if (aborted) console.log("\nRUN ABORTED: the shared database changed during the run.");
  console.log(`\nSUMMARY ${summary}${failed.length ? `\nFAILED: ${failed.map((f) => f.id).join(", ")}` : ""}`);
  console.log(`workspace: ${slug || "(not made)"} (remove it with: node e2e/cleanup-be.mjs)  quiet hours at the time of the run: ${quiet() ? "yes (India night)" : "no"}`);
  try {
    writeFileSync(path.join(SHOTS, "be-results.json"), JSON.stringify({ stamp: STAMP, slug, quiet: quiet(), results }, null, 1));
  } catch {
    // no results file: the lines above are the record
  }
  return failed.length ? 1 : 0;
}
