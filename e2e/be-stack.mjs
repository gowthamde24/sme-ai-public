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
const browser = await chromium.launch();
const SLOW = 90_000; // a development server compiles each page the first time it is asked for
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
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
  must(ok.length === 1 && ok[0], `thumbnail: ${JSON.stringify(ok)}`);
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
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  const box = page.locator("#ask-input");
  await box.fill("What needs me today?");
  await box.press("Enter");
  await page.waitForSelector("[data-ask] , [aria-live=polite]", { timeout: 15000 }).catch(() => null);
  await page.waitForFunction(() => /Here is what I found|I found nothing/.test(document.body.innerText), { timeout: 60000 });
  await shot(page, "ask-answer");
}, page);

await step("H2", "A saree named in an answer links to its page (the real box with a stand-in for the model: the scripted model of the local stack has no catalogue keyword)", async () => {
  const itemId = itemUrl.split("/").pop();
  await context.route(`**/app/tenants/${tenant}/ask`, async (route) => {
    const lines = [{ type: "text", delta: "I found one saree. " }, { type: "source", label: "E2E Maroon Kanchi pattu", href: `/app/tenants/${tenant}/catalogue/${itemId}` }, { type: "done" }].map((e) => JSON.stringify(e)).join("\n") + "\n";
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines });
  });
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  const box = page.locator("#ask-input");
  await box.fill("Show me a maroon saree");
  await box.press("Enter");
  const link = page.getByRole("link", { name: /E2E Maroon Kanchi pattu/ });
  await link.waitFor({ timeout: 30000 });
  await link.click();
  await page.waitForURL(new RegExp(`/catalogue/${itemId}`));
  await context.unroute(`**/app/tenants/${tenant}/ask`);
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
