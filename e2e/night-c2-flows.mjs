// Night run C2, the real-stack run of the screens of jobs CO, CQ, CS and CU: the REAL web (3002, `next dev`), the REAL API (8002) and the LOCAL Supabase (the AGENT stack), through a real browser. Throwaway accounts
// e2e-<stamp>-*@e2e.example.test, invented data, nothing leaves this machine (`make e2e-c2`, which starts and stops the API and the web by PID and cleans up).
//   education:    the institution and its programmes and sections -> a fee plan -> an admission enquiry, its stages and the admit (with the plan) -> the student's fee account: a payment and its receipt, a concession by percent
//                 -> the collection screen and the pending list -> the students file (mapping, preview, import) -> an announcement with its audience and the check-and-approve tab (no child's name in a sample) -> the reports
//                 -> Today's school cards, the checklist and the phone's four tabs
//   construction: a customer (API) -> a product and a delivery site through the forms -> invoices (API) and a payment and its receipt through the form -> a reminder campaign: the ledger audience, the samples, the
//                 approval with the second factor -> the call list -> the reports -> Today's cards and the phone's four tabs
//   textiles:     the saree shop's own screens are unchanged (Today, Quotes, Orders, the weekly report, the five tabs of the phone)
// Then pictures of every pack's screens (light and dark, 1280 x 900 and 390 x 844) into E2E_SHOTS (default ~/Desktop/v2-overnight/shots-night).
// Prints one line per step: PASS or FAIL, and a summary; exit code 1 if any step failed. Never the ports 3000, 8000 or 8001. The throwaway workspaces are renamed to "E2E Silks <stamp> <label>" (local database only) so that
// e2e/cleanup-be.mjs finds and removes them.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import "./be-env.mjs";
import { chromium } from "playwright";

import { confirmEmail, factorSecret, passChallenge } from "./lib.mjs";
import { API, BASE, PW, STAMP, aal2Token, api, gotrue, psql, sharedDatabaseProblem, totp, uuid } from "./be-lib.mjs";

const OUT = process.env.E2E_SHOTS || path.join(os.homedir(), "Desktop", "v2-overnight", "shots-night");
mkdirSync(OUT, { recursive: true });
const results = [];
const must = (cond, what) => {
  if (!cond) throw new Error(what);
};
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const tenants = new Set();
let browser;
function changedUnderUs() {
  try {
    for (const t of tenants) if (psql(`select count(*) from public.tenants where id = '${t}'`) === "0") return "a workspace of this run is gone: the database was reset by another session";
    return sharedDatabaseProblem();
  } catch {
    return "the database cannot be read (another session is restarting it)";
  }
}
let failShot = 0;
async function step(id, title, fn, page) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, title, status: "PASS", note: note || "" });
    console.log(`PASS  ${id} ${title}${note ? ` :: ${note}` : ""}  (${Date.now() - t0} ms)`);
    return true;
  } catch (error) {
    let where = "";
    if (page) {
      where = path.join(OUT, `FAIL-${String(++failShot).padStart(2, "0")}-${id}.png`);
      await page.screenshot({ path: where, fullPage: true }).catch(() => null);
    }
    results.push({ id, title, status: "FAIL", note: String(error?.message ?? error).split("\n")[0] });
    console.log(`FAIL  ${id} ${title} :: ${String(error?.message ?? error).split("\n")[0]} ${where ? `[${where}]` : ""}`);
    const why = changedUnderUs();
    if (why) {
      console.log(`ABORT ${why}. This is not a fault of the product: run it again when nothing else uses the database.`);
      await browser?.close().catch(() => null);
      process.exit(4);
    }
    return false;
  }
}

const busy = sharedDatabaseProblem();
if (busy) {
  console.error(`e2e: not starting: ${busy}.`);
  process.exit(3);
}
browser = await chromium.launch();
const SLOW = 120_000; // a development server compiles each page the first time it is asked for
const problems = [];
const watch = (page) => {
  page.setDefaultTimeout(SLOW);
  page.setDefaultNavigationTimeout(SLOW);
  page.on("console", (m) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following|Hydration failed/i.test(m.text())) problems.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
};

const cards = await (await fetch(`${API}/v1/packs`)).json();
const IDS = cards.packs.map((p) => p.pack_id);
const idOf = (needle) => IDS.find((id) => id.includes(needle));
const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A business of one type, made by the sign-up, with an authenticator on and the session at the second level. */
async function startBusiness(label, packId) {
  const email = `e2e-${STAMP}-${label}@e2e.example.test`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await context.newPage();
  watch(page);
  const u = { label, packId, email, context, page, tenant: "", token: "", base: "" };
  await step(`${label}-0`, `the business is made by the sign-up as ${packId}, the second step (an authenticator) is turned on, and the session is at the second level`, async () => {
    await page.goto(`${BASE}/signup?type=${packId}`);
    await page.locator("details[data-signup=email] summary").click();
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", PW);
    await Promise.all([page.waitForURL(/\/signup\/check-email/, { timeout: 30000 }), page.click('details[data-signup=email] button[type="submit"]')]);
    confirmEmail(email);
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/setup/, { timeout: 30000 });
    await page.waitForURL(/\/app\/tenants\/[0-9a-f-]{36}/, { timeout: 90000 });
    u.tenant = /tenants\/([0-9a-f-]{36})/.exec(page.url())[1];
    psql(`begin; set local session_replication_role = replica; update public.tenants set name = 'E2E Silks ${STAMP} ${label}', slug = 'e2e-${STAMP}-${label}' where id = '${u.tenant}'; commit;`);
    tenants.add(u.tenant);
    u.base = `${BASE}/app/tenants/${u.tenant}`;
    await page.goto(`${BASE}/app/security`);
    await page.click('button:has-text("Set up an authenticator")');
    await page.waitForSelector('img[alt^="QR code"]');
    const secret = (await page.locator("form code").first().innerText()).trim();
    let on = false;
    for (const offset of [0, 1, -1, 2]) {
      await page.fill('input[name="code"]', totp(secret, offset));
      await page.click('button:has-text("Turn on")');
      try {
        await page.waitForSelector("text=Done. Your authenticator is on.", { timeout: 6000 });
        on = true;
        break;
      } catch {
        // a code is used once per 30 s step: try the next
      }
    }
    must(on, "the authenticator was not turned on");
    await context.clearCookies();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/auth\/mfa/, { timeout: 30000 });
    await passChallenge(page, email);
    u.token = await aal2Token(email);
    return `${u.tenant}`;
  }, page);
  return u;
}

const T = (u, p = "") => `${u.base}${p}`;
const go = async (u, p) => {
  await u.page.goto(T(u, p), { waitUntil: "networkidle" });
};
const sheet = (page) => page.getByRole("dialog");

// ================================================================================================================ education ==================
const edu = {};
async function education() {
  const u = await startBusiness("edu", idOf("education"));
  if (!u.tenant) return u;
  const { page } = u;
  const t = u.tenant;
  await step("EDU-1", "the institution and its programmes: saved, a class with two sections made through the forms, and the API holds them", async () => {
    await go(u, "/programmes");
    await page.locator('[data-screen="programmes"]').waitFor();
    await page.selectOption("#pf-start", "6");
    await page.getByRole("button", { name: "Save the institution" }).click();
    await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    await page.getByRole("button", { name: "Add a class or course" }).first().click();
    await page.fill("#pg-name", "Class 5");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await page.locator("[data-programme]").first().waitFor();
    for (const label of ["A", "B"]) {
      await page.getByRole("button", { name: "Add a section" }).click();
      await page.fill("#gr-label", label);
      await sheet(page).getByRole("button", { name: "Save" }).click();
      await page.getByRole("button", { name: new RegExp(`^Change ${label}`) }).waitFor();
    }
    const profile = await api("GET", `/v1/tenants/${t}/institution/profile`, null, u.token);
    const programmes = await api("GET", `/v1/tenants/${t}/institution/programmes`, null, u.token);
    must(profile.body?.configured === true && profile.body.year_start_month === 6, `the profile is ${JSON.stringify(profile.body)}`);
    const item = programmes.body?.items?.[0];
    must(item?.name === "Class 5" && (item.groups ?? []).map((g) => g.label).sort().join() === "A,B", `the programmes are ${JSON.stringify(programmes.body).slice(0, 200)}`);
    edu.programme = item.id;
    edu.groups = Object.fromEntries(item.groups.map((g) => [g.label, g.id]));
    return "profile, Class 5, sections A and B";
  }, page);

  await step("EDU-2", "a fee plan through the form: two instalments, the total added up as typed, saved, and read only afterwards", async () => {
    await go(u, "/fees/plans/new");
    await page.fill("#fp-name", "Class 5 fees (e2e)");
    await page.fill("#fp-d0", "2026-06-15");
    await page.fill("#fp-a0", "25000");
    await page.getByRole("button", { name: "Add a row" }).click();
    await page.fill("#fp-n1", "2");
    await page.fill("#fp-d1", "2026-10-15");
    await page.fill("#fp-a1", "15000");
    must(/Total: ₹40,000\.00/.test(await text(page)), "the total is not 40,000");
    await page.getByRole("button", { name: "Save the plan" }).click();
    await page.waitForURL(/\/fees\/plans\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
    edu.plan = /plans\/([0-9a-f-]{36})/.exec(page.url())[1];
    must((await text(page)).includes("₹40,000.00"), "the plan page does not show the total");
    must((await page.getByRole("link", { name: "Make a copy as a new plan" }).count()) === 1, "no copy link");
    const plans = await api("GET", `/v1/tenants/${t}/institution/fee-plans`, null, u.token);
    must(plans.body?.items?.length === 1 && plans.body.items[0].total_paise === 4000000, `the plans are ${JSON.stringify(plans.body).slice(0, 160)}`);
    return `plan ${edu.plan}`;
  }, page);

  await step("EDU-3", "an admission enquiry (a new parent: a name and a number, no child), moved to an application, then admitted with a fee plan in one go", async () => {
    await go(u, "/admissions/new");
    await page.fill("#ad-name", "Ravi Kumar (e2e)");
    await page.fill("#ad-phone", "+00 11111 11111");
    await page.selectOption("#ad-prog", edu.programme);
    await page.getByRole("button", { name: "Save the enquiry" }).click();
    await page.waitForURL(/\/admissions\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
    edu.admission = /admissions\/([0-9a-f-]{36})/.exec(page.url())[1];
    await page.getByRole("button", { name: "Application received" }).click();
    await page.getByRole("button", { name: "Admit", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Admit", exact: true }).first().click();
    await page.fill("#am-label", "Asha");
    await page.selectOption("#am-group", edu.groups.A);
    await page.selectOption("#am-plan", edu.plan);
    await sheet(page).getByRole("button", { name: "Admit", exact: true }).click();
    await page.waitForURL(/\/students\/[0-9a-f-]{36}\?saved=1/, { timeout: 90000 });
    edu.student = /students\/([0-9a-f-]{36})/.exec(page.url())[1];
    must((await text(page)).includes("Asha"), "the student page does not show the first name");
    const students = await api("GET", `/v1/tenants/${t}/institution/students`, null, u.token);
    must(students.body?.items?.length === 1 && students.body.items[0].display_name === "Asha" && students.body.items[0].group_label === "A", `the students are ${JSON.stringify(students.body).slice(0, 200)}`);
    const fees = await api("GET", `/v1/tenants/${t}/institution/students/${edu.student}/fees`, null, u.token);
    must(fees.body?.statement?.outstanding_paise === 4000000, `the student owes ${fees.body?.statement?.outstanding_paise}`);
    return "admitted with the plan: 40,000 charged on the student's own account";
  }, page);

  await step("EDU-4", "the student's fee account: a payment through the form gets a receipt number at once; the receipt prints and copies; a concession by percent with the second factor", async () => {
    await go(u, `/fees/students/${edu.student}`);
    await page.getByRole("button", { name: "Write down a payment" }).click();
    await page.fill("#amt-payment", "10000");
    await page.selectOption("#method-payment", "upi");
    await sheet(page).getByRole("button", { name: "Write down the payment" }).click();
    const link = page.getByRole("link", { name: /^Receipt R\// }).first();
    await link.waitFor();
    const receiptNo = (await link.innerText()).replace("Receipt ", "").trim();
    await link.click();
    await page.locator('[data-screen="receipt"]').waitFor();
    const body = await text(page);
    must(body.includes(receiptNo) && body.includes("₹10,000.00") && body.includes("Asha"), `the receipt says ${body.slice(0, 200)}`);
    must((await page.getByRole("button", { name: "Copy as a message" }).count()) === 1 && (await page.getByRole("button", { name: "Print or save as PDF" }).count()) === 1, "no copy or print button");
    edu.receipt = /receipt\/([0-9a-f-]{36})/.exec(page.url())[1];
    await go(u, `/fees/students/${edu.student}`);
    await page.getByRole("button", { name: "Give a concession" }).click();
    await page.getByRole("radio", { name: /A percentage of what was charged/ }).check();
    await page.fill("#amt-concession", "10");
    await sheet(page).getByRole("button", { name: "Give the concession" }).click();
    await page.getByRole("status").filter({ hasText: "concession" }).first().waitFor();
    const fees = await api("GET", `/v1/tenants/${t}/institution/students/${edu.student}/fees`, null, u.token);
    // 40,000 charged, 10,000 paid, 10% of what was charged (4,000) conceded: 26,000 pending
    must(fees.body?.statement?.outstanding_paise === 2600000, `the student owes ${fees.body?.statement?.outstanding_paise}`);
    return `receipt ${receiptNo}; 26,000 pending after the payment and the concession`;
  }, page);

  await step("EDU-5", "the collection screen (due, collected, pending as figures of the report), the pending list and the late fees looked at (nothing changed by looking)", async () => {
    await go(u, "/fees");
    await page.locator('[data-screen="fees"]').waitFor();
    must((await page.locator("[data-kpi=due_paise]").count()) === 1 && (await page.locator("[data-kpi=pending_paise]").count()) === 1, "the figures are missing");
    const body = await text(page);
    must(!/defaulter/i.test(body) && !/_paise|_pct/.test(body), "a harsh word or a raw key is on the page");
    must(/Fees collected today|Collected today/i.test(body), "no collected-today card");
    await go(u, "/fees/pending");
    await page.locator('[data-screen="fees-pending"]').waitFor();
    must((await page.locator("[data-pending]").count()) === 1 && (await text(page)).includes("Asha"), "the student is not on the pending list");
    const late = await api("GET", `/v1/tenants/${t}/institution/late-fees`, null, u.token);
    must(late.status === 200, `late fees ${late.status}`);
    const after = await api("GET", `/v1/tenants/${t}/institution/students/${edu.student}/fees`, null, u.token);
    must(after.body?.statement?.outstanding_paise === 2600000, "looking at the late fees changed the account");
    return `pending list: 1 student; ${late.body?.count ?? 0} late instalments`;
  }, page);

  await step("EDU-6", "the students file: choose a CSV, say which column is which, see every row, import with the second factor (a parent is found or made, never a child's name in the preview)", async () => {
    await go(u, "/students/import");
    const csv = ["Parent name,Parent phone,Class,Section,Student,Admission no", "Lakshmi Devi (e2e),+00 22222 22222,Class 5,B,Kiran,B-2001", "Suresh Babu (e2e),+00 33333 33333,Class 9,A,Meena,C-3001"].join("\n");
    await page.setInputFiles('input[type="file"]', { name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByText("Which column is which?").waitFor();
    await page.getByRole("button", { name: "Show what would happen" }).click();
    await page.getByText("What would happen").waitFor();
    const preview = await text(page);
    must(!preview.includes("Kiran") && !preview.includes("Meena"), "a child's name is in the preview");
    must(/Lakshmi Devi \(e2e\)/.test(preview), "the parent is not in the preview");
    must(/needs review|Needs review/i.test(preview), "the class the school does not have is not flagged");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText("Import finished").waitFor();
    const students = await api("GET", `/v1/tenants/${t}/institution/students`, null, u.token);
    must(students.body?.items?.length === 2, `${students.body?.items?.length} students after the import (one row names a class the school does not have)`);
    return "1 student created, 1 row needing review (a class the school does not have: never invented)";
  }, page);

  await step("EDU-7", "an announcement: written, its audience chosen from the students (one message per parent), and the check-and-approve tab shows samples with no child's name and says what is missing", async () => {
    await go(u, "/announcements/new");
    await page.fill("#cf-name", "Parents meeting (e2e)");
    await page.fill("#cf-text", "Hello {{name}}, the parents meeting is on {{due_date}}. {{business}}");
    await page.getByRole("button", { name: "Save the draft" }).click();
    await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\?.*tab=audience/, { timeout: 60000 });
    edu.announcement = /campaigns\/([0-9a-f-]{36})/.exec(page.url())[1];
    const day = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    await page.fill("#as-date", day);
    await page.getByRole("button", { name: "Add the parents" }).click();
    await page.getByRole("status").filter({ hasText: "people added" }).waitFor();
    await go(u, `/campaigns/${edu.announcement}?tab=approve`);
    await page.locator("[data-part=approval]").waitFor();
    const body = await text(page);
    must(!/Asha|Kiran|Meena/.test(body), "a child's name is in a sample");
    must(/Not ready yet/.test(body), "what is missing is not listed");
    must(await page.getByRole("button", { name: "Approve this campaign" }).isDisabled(), "the approve button is on while something is missing");
    return "audience built from the students; approval waits for a template";
  }, page);

  await step("EDU-8", "the reports: the Reports page lists the school's own reports and the collection report runs for a range", async () => {
    await go(u, "/report");
    await page.locator("[data-part=pack-reports]").waitFor();
    must((await page.locator("[data-report]").count()) === 4, "the school should have four reports");
    must(!/saree/i.test(await text(page)), "the report page says saree to a school");
    await go(u, "/report/education.collection");
    await page.locator('[data-screen="pack-report"]').waitFor();
    must((await page.locator("[data-kpi=collected_paise]").count()) === 1, "no collected figure");
    const body = await text(page);
    must(body.includes("₹10,000.00") || body.includes("1,00,000"), `the collected figure is not 10,000 (${body.slice(0, 300)})`);
    return "4 reports; collection shows the payment";
  }, page);

  await step("EDU-9", "Today for a school: the school cards (collection, reminders, campus visits), the first-run steps with real screens, and the phone's four tabs (Today, Inbox, Fees, Contacts)", async () => {
    await go(u, "");
    await page.locator('[data-screen="today"]').waitFor();
    const body = await text(page);
    must(/Fees collected today/.test(body) && /Reminders running/.test(body) && /Campus visits today/.test(body), "a school card is missing");
    must((await page.locator('[data-step="institution_set"][data-state="done"]').count()) === 1, "the institution step is not done");
    must((await page.locator('[data-step="students_imported"][data-state="done"]').count()) === 1, "the students step is not done");
    must((await page.locator('[data-step="fee_plan_set"][data-state="done"]').count()) === 1, "the fee plan step is not done");
    await page.setViewportSize({ width: 390, height: 844 });
    await go(u, "");
    const tabs = await page.locator('nav[aria-label="Quick menu"] a').evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().replace(/Waiting for you: \d+/, "").trim()));
    must(JSON.stringify(tabs) === JSON.stringify(["Today", "Inbox", "Fees", "Contacts"]), `the tabs are ${tabs.join(" | ")}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    return `tabs: ${tabs.join(", ")}`;
  }, page);
  return u;
}

// ============================================================================================================ construction =================
const con = {};
async function construction() {
  const u = await startBusiness("con", idOf("construction"));
  if (!u.tenant) return u;
  const { page } = u;
  const t = u.tenant;
  await step("CON-1", "a customer (the API) and a product through the form: sold per sq ft, with its price; the product page and the list show it", async () => {
    con.company = uuid();
    const made = await api("POST", `/v1/tenants/${t}/companies`, { id: con.company, name: "Sri Rama Builders (e2e)", type: "customer", country: "IN", city: "Guntur" }, u.token);
    must(made.status === 200 || made.status === 201, `company: HTTP ${made.status} ${JSON.stringify(made.body).slice(0, 120)}`);
    await go(u, "/materials/new");
    await page.fill("#mat-name", "Paver block 200x100 (e2e)");
    await page.selectOption("#mat-unit", "sq_ft");
    if (await page.locator("#mat-price").count()) await page.fill("#mat-price", "42.50");
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/\/materials\/[0-9a-f-]{36}/, { timeout: 90000 });
    con.item = /materials\/([0-9a-f-]{36})/.exec(page.url())[1];
    await go(u, "/materials");
    must((await text(page)).includes("Paver block 200x100 (e2e)"), "the product is not in the list");
    must(!/saree/i.test(await text(page)), "the products page says saree");
    return `product ${con.item}`;
  }, page);

  await step("CON-2", "a delivery site through the form: its address, its distance and the notes a driver needs; it is listed under its customer", async () => {
    await go(u, `/sites/new?company=${con.company}`);
    await page.fill("#site-name", "Kukatpally villa (e2e)");
    await page.fill("#site-city", "Guntur");
    await page.fill("#site-distance", "18");
    await page.fill("#site-notes", "Gate on the left. Unloading help available.");
    await page.getByRole("button", { name: "Save the site" }).click();
    await page.waitForURL(/\/sites(\?|$)/, { timeout: 60000 });
    must((await text(page)).includes("Kukatpally villa (e2e)"), "the site is not listed");
    const sites = await api("GET", `/v1/tenants/${t}/sites`, null, u.token);
    must((sites.body?.items ?? []).some((s) => s.name === "Kukatpally villa (e2e)" && s.company_id === con.company), "the API does not hold the site");
    return "1 site";
  }, page);

  await step("CON-3", "dues: two invoices (the API), then a payment through the form with a receipt; the account, the ageing and the dues list agree", async () => {
    const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    for (const [no, amount, due] of [["INV-E2E-1", 12000000, day(-9)], ["INV-E2E-2", 8000000, day(4)]]) {
      const r = await api("PUT", `/v1/tenants/${t}/ledger/entries/${uuid()}`, { kind: "charge", company_id: con.company, entry_date: day(-20), due_date: due, amount_paise: amount, invoice_no: no }, u.token);
      must(r.status === 200 || r.status === 201, `invoice ${no}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    await go(u, "/dues");
    await page.locator('[data-screen="dues"]').waitFor();
    must((await text(page)).includes("Sri Rama Builders (e2e)"), "the customer is not on the dues list");
    await go(u, `/dues/${con.company}`);
    await page.getByRole("button", { name: "Write down a payment" }).click();
    await page.fill("#amt-payment", "70000");
    await page.selectOption("#method-payment", "upi");
    await sheet(page).getByRole("button", { name: "Write down the payment" }).click();
    const link = page.getByRole("link", { name: /^Receipt R\// }).first();
    await link.waitFor();
    await link.click();
    await page.locator('[data-screen="receipt"]').waitFor();
    must((await text(page)).includes("₹70,000.00"), "the receipt does not say 70,000");
    const st = await api("GET", `/v1/tenants/${t}/ledger/statement?company_id=${con.company}`, null, u.token);
    must(st.body?.outstanding_paise === 13000000, `the customer owes ${st.body?.outstanding_paise}`);
    return "owed 1,30,000 after the payment";
  }, page);

  await step("CON-4", "a payment-due reminder campaign: the form, the audience from the ledger, the samples as each person reads them, and the approval once with the second factor", async () => {
    // an approved reminder template (what Meta decided, written by the Owner: the local run has no Meta)
    const tpl = uuid();
    const put = await api("PUT", `/v1/tenants/${t}/whatsapp/templates/${tpl}`, { name: "payment_reminder_e2e", language: "en", category: "utility", purpose: "reminder", body: "Hello, a payment reminder: {{1}}. Thank you." }, u.token);
    must(put.status === 200, `template: HTTP ${put.status} ${JSON.stringify(put.body).slice(0, 120)}`);
    const ok = await api("POST", `/v1/tenants/${t}/whatsapp/templates/${tpl}/status`, { status: "approved" }, u.token);
    must(ok.status === 200, `template status: HTTP ${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`);
    await go(u, "/campaigns/new");
    await page.fill("#cf-name", "October payment reminders (e2e)");
    await page.fill("#cf-text", "Hello {{name}}, a payment of {{amount}} for {{reference}} is due on {{due_date}}. {{business}}");
    await page.selectOption("#cf-template", tpl);
    await page.getByRole("button", { name: "Save the draft" }).click();
    await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
    con.campaign = /campaigns\/([0-9a-f-]{36})/.exec(page.url())[1];
    await go(u, `/campaigns/${con.campaign}?tab=audience`);
    const from = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    await page.fill("#al-from", from);
    await page.fill("#al-to", to);
    await page.getByRole("button", { name: "Add from the ledger" }).click();
    await page.getByRole("status").filter({ hasText: "people added" }).waitFor().catch(() => null);
    await go(u, `/campaigns/${con.campaign}?tab=approve`);
    await page.locator("[data-part=approval]").waitFor();
    const before = await text(page);
    must(/₹1,30,000\.00|₹130,000/.test(before) || /1,30,000/.test(before), `the total is not 1,30,000 (${before.slice(0, 300)})`);
    must(/Reply STOP/.test(before), "the disclosure line is not shown");
    await page.getByRole("button", { name: "Approve this campaign" }).click();
    await sheet(page).getByRole("checkbox").check();
    await sheet(page).getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Approved" }).waitFor();
    const detail = await api("GET", `/v1/tenants/${t}/campaigns/${con.campaign}`, null, u.token);
    must(["approved", "running"].includes(detail.body?.status), `the campaign is ${detail.body?.status}`);
    await go(u, `/campaigns/${con.campaign}?tab=results`);
    await page.locator("[data-part=results]").waitFor();
    return `campaign ${detail.body.status}; nothing was sent by approving`;
  }, page);

  await step("CON-5", "the call list and the reports: the call list says nobody is due; the reports list the builder's five and the dues report runs", async () => {
    await go(u, "/call-list");
    await page.locator('[data-screen="call-list"]').waitFor();
    must((await text(page)).includes("Nobody to call right now"), "the call list is not empty");
    await go(u, "/report");
    await page.locator("[data-part=pack-reports]").waitFor();
    must((await page.locator("[data-report]").count()) === 5, "the builder should have five reports");
    await go(u, "/report/construction.dues_ageing");
    await page.locator('[data-screen="pack-report"]').waitFor();
    const body = await text(page);
    must(body.includes("Sri Rama Builders (e2e)") && /1,30,000/.test(body), `the dues report says ${body.slice(0, 300)}`);
    return "5 reports; the dues report names the customer";
  }, page);

  await step("CON-6", "Today for a builder: the cards (dues this week) and the phone's four tabs (Today, Inbox, Orders & deliveries, Contacts); the menu says no saree", async () => {
    await go(u, "");
    await page.locator('[data-screen="today"]').waitFor();
    must(!/saree/i.test(await page.locator("nav").first().innerText()), "the menu says saree");
    await page.setViewportSize({ width: 390, height: 844 });
    await go(u, "");
    const tabs = await page.locator('nav[aria-label="Quick menu"] a').evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().replace(/Waiting for you: \d+/, "").trim()));
    must(tabs.length === 4 && tabs[0] === "Today" && tabs[1] === "Inbox" && tabs[3] === "Contacts", `the tabs are ${tabs.join(" | ")}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    return `tabs: ${tabs.join(", ")}`;
  }, page);
  return u;
}

// ================================================================================================================== textiles ==================
const tex = {};
async function textiles() {
  const u = await startBusiness("txt", IDS[0]);
  if (!u.tenant) return u;
  const { page } = u;
  await step("TXT-1", "the saree shop is unchanged: its five tabs on the phone (Today, Leads, Quotes, Visits, Office), no school or builder page in the menu, and the weekly report has the sarees card", async () => {
    await go(u, "");
    await page.setViewportSize({ width: 390, height: 844 });
    await go(u, "");
    const tabs = await page.locator('nav[aria-label="Quick menu"] a').evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().replace(/Waiting for you: \d+/, "").trim()));
    must(JSON.stringify(tabs) === JSON.stringify(["Today", "Leads", "Quotes", "Visits", "Office"]), `the tabs are ${tabs.join(" | ")}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    const menu = await page.locator('nav[aria-label="Workspace menu"]').innerText();
    for (const word of ["Students", "Fees", "Call list", "Sites", "Dues"]) must(!menu.includes(word), `the saree shop's menu has ${word}`);
    await go(u, "/report");
    must(/Sarees sent most/.test(await text(page)), "the weekly report lost its sarees card");
    must((await page.locator("[data-part=pack-reports]").count()) === 0, "the saree shop has pack reports");
    return "five tabs; menu without the new pages; weekly report as before";
  }, page);
  void tex;
  return u;
}

// ======================================================================================================================== pictures ==============
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };
async function pictures(u, label, paths) {
  if (!u?.tenant) return;
  const state = await u.context.storageState();
  let n = 0;
  for (const scheme of ["light", "dark"]) {
    for (const [sizeName, size] of Object.entries(SIZES)) {
      const context = await browser.newContext({ storageState: state, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
      const page = await context.newPage();
      watch(page);
      for (const [slug, p] of paths) {
        try {
          await page.goto(`${u.base}${p}`, { waitUntil: "networkidle" });
          await page.screenshot({ path: path.join(OUT, `${label}-${slug}-${scheme}-${sizeName}.png`), fullPage: true });
          n += 1;
        } catch (error) {
          console.log(`FAIL  shots ${label} ${slug} ${scheme} ${sizeName} :: ${String(error?.message ?? error).split("\n")[0]}`);
          results.push({ id: `shots-${label}-${slug}`, title: "a picture", status: "FAIL", note: String(error?.message ?? error).split("\n")[0] });
        }
      }
      await context.close();
    }
  }
  console.log(`PASS  shots ${label}: ${n} pictures in ${OUT}`);
}

const uEdu = await education();
await pictures(uEdu, "edu", [
  ["today", ""], ["programmes", "/programmes"], ["students", "/students"], ["student", `/students/${edu.student}`], ["students-import", "/students/import"], ["fees", "/fees"], ["fees-pending", "/fees/pending"], ["fee-plans", "/fees/plans"],
  ["fee-plan", `/fees/plans/${edu.plan}`], ["fee-plan-new", "/fees/plans/new"], ["student-fees", `/fees/students/${edu.student}`], ["receipt", `/fees/receipt/${edu.receipt}`], ["admissions", "/admissions"], ["admission", `/admissions/${edu.admission}`],
  ["announcements", "/announcements"], ["announcement-audience", `/campaigns/${edu.announcement}?tab=audience`], ["announcement-approve", `/campaigns/${edu.announcement}?tab=approve`], ["reports", "/report"], ["report-collection", "/report/education.collection"],
]);
const uCon = await construction();
await pictures(uCon, "con", [
  ["today", ""], ["products", "/materials"], ["product", `/materials/${con.item}`], ["sites", "/sites"], ["quotes", "/quotes"], ["dues", "/dues"], ["customer-dues", `/dues/${con.company}`], ["campaigns", "/campaigns"],
  ["campaign-overview", `/campaigns/${con.campaign}`], ["campaign-audience", `/campaigns/${con.campaign}?tab=audience`], ["campaign-approve", `/campaigns/${con.campaign}?tab=approve`], ["campaign-results", `/campaigns/${con.campaign}?tab=results`],
  ["call-list", "/call-list"], ["trips", "/orders/trips"], ["reports", "/report"], ["report-dues", "/report/construction.dues_ageing"],
]);
const uTxt = await textiles();
await pictures(uTxt, "txt", [["today", ""], ["catalogue", "/catalogue"], ["quotes", "/quotes"], ["orders", "/orders"], ["outbox", "/outbox"], ["report", "/report"]]);

for (const u of [uEdu, uCon, uTxt]) await u?.context?.close().catch(() => null);
await browser.close();
const failed = results.filter((r) => r.status === "FAIL");
writeFileSync(path.join(OUT, "steps.txt"), results.map((r) => `${r.status} ${r.id} ${r.title}${r.note ? ` :: ${r.note}` : ""}`).join("\n") + "\n");
console.log(`\ne2e: ${results.length - failed.length} passed, ${failed.length} failed`);
if (problems.length) console.log(`browser problems:\n${[...new Set(problems)].slice(0, 8).join("\n")}`);
void factorSecret;
void gotrue;
void rupees;
process.exit(failed.length || problems.length ? 1 : 0);
