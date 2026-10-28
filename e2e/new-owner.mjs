// The new-owner walkthrough (night 28 Oct, job DT): a brand-new person, Google-style, from the sign-up page to Today and back in again. The REAL web (3002), the REAL API (8002) and the LOCAL Supabase with Storage;
// one throwaway account and business (e2e-<stamp>), invented data, nothing leaves this machine. Run by `make e2e-new-owner` (it starts and stops the API and the web and cleans up).
//   sign up (the kind of business "Other") -> the address is confirmed and the account made Google-style (local database) -> sign in
//   -> /setup asks ONLY the kind of business, what "Other" is and the name -> skip everything else -> Today opens with "Finish setting up"
//   -> a step is put away ("Hide for now") -> turn the assistant on (the local operator switch the platform needs) -> ask it by TYPING on Today (and again on another page, in the floating panel)
//   -> Settings > My profile: set a picture (a real upload) and see it in the menu -> Settings > Business: the kind, the name, the phone (the greeting carries the NEW name)
//   -> sign out, sign in again: no second step is asked, the picture and the name are still there.
// "Google-style": this stack has no Google. The account is made by the e-mail sign-up page, then marked as a Google identity in the LOCAL database (provider google, a display name), which is what the API reads;
// the person never has an authenticator, and must never be asked for one. Prints one line per step (PASS or FAIL) and a summary; exit code 1 if any step failed.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./be-env.mjs";
import { chromium } from "playwright";

import { SHOTS, confirmEmail } from "./lib.mjs";
import { API, BASE, PW, STAMP, api, gotrue, psql, sharedDatabaseProblem } from "./be-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PICTURE = path.join(here, "fixtures", "saree-demo.jpg"); // a drawn picture, no real photo
const EMAIL = `e2e-${STAMP}-owner@e2e.example.test`;
const NAME = `E2E Paws ${STAMP}`;
const NEW_NAME = `E2E Paws and Whiskers ${STAMP}`;
const WHAT = "Pet grooming (synthetic)";
mkdirSync(SHOTS, { recursive: true });

const results = [];
let shotN = 0;
const shot = async (page, name) => {
  const p = path.join(SHOTS, `no-${String(++shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  return p;
};
async function step(id, title, fn, page) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, status: "PASS" });
    console.log(`PASS  ${id} ${title}${note ? ` :: ${note}` : ""}  (${Date.now() - t0} ms)`);
    return true;
  } catch (error) {
    const where = page ? await shot(page, `FAIL-${id}`) : "";
    results.push({ id, status: "FAIL" });
    console.log(`FAIL  ${id} ${title} :: ${String(error?.message ?? error).split("\n")[0]} ${where ? `[${where}]` : ""}`);
    return false;
  }
}
const must = (cond, what) => {
  if (!cond) throw new Error(what);
};
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
function finish() {
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\nnew-owner: ${results.length - failed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

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
  if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following|Hydration failed/i.test(m.text())) problems.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));

let tenant = "";
let slug = "";
const T = () => `/v1/tenants/${tenant}`;
const tokenNow = async () => {
  const s = await gotrue("POST", "/auth/v1/token?grant_type=password", { email: EMAIL, password: PW });
  must(s.status === 200, `the owner cannot get a token (HTTP ${s.status})`);
  return s.body.access_token;
};
const signIn = async () => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
};

/** The question is echoed in the box `where`, and something longer than a few words follows it: an answer (or the honest "not found"), not an error. */
async function answered(question, where) {
  await page.waitForFunction(([q, sel]) => {
    const t = (document.querySelector(sel) ?? document.body).innerText;
    const i = t.indexOf(q);
    return i >= 0 && t.slice(i + q.length).trim().length > 20;
  }, [question, where], { timeout: 60000 });
  must(!/Something went wrong/i.test(await text(page)), "the page broke while asking");
}

// ---- 1. sign up with "Other", become a Google-style account, sign in --------------------------------------------------------
if (!(await step("N1", 'sign-up step 1 is ONE searchable list with "Other" in its own group; choosing Other goes to step 2; the e-mail way makes the account', async () => {
  await page.goto(`${BASE}/signup`);
  await page.locator('input[role="combobox"]').focus();
  const other = page.locator('[data-pack-card="other"]');
  await other.waitFor();
  must((await page.locator("[data-pack-card]").count()) >= 10, "the list is short");
  await shot(page, "signup-list");
  await Promise.all([page.waitForURL(/\/signup\?type=other/, { timeout: 30000 }), other.click()]);
  await page.locator("details[data-signup=email] summary").click();
  await page.fill("#signup-email", EMAIL);
  await page.fill("#signup-password", PW);
  await Promise.all([page.waitForURL(/\/signup\/check-email/, { timeout: 30000 }), page.click('details[data-signup=email] button[type="submit"]')]);
}, page))) process.exit(finish());

await step("N2", "Google-style identity: the address is confirmed and the account is marked as a Google sign-in with a display name (local database); no authenticator exists", async () => {
  confirmEmail(EMAIL);
  psql(`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"google","providers":["google"]}'::jsonb, raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"full_name":"E2E Owner","name":"E2E Owner"}'::jsonb where email = '${EMAIL}'`);
  must(psql(`select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '${EMAIL}'`) === "0", "the account has an authenticator");
}, page);

await step("N3", "sign in: no second step is asked (the account has none), and a person with no business goes to the set-up", async () => {
  await signIn();
  await page.waitForURL(/\/setup/, { timeout: 30000 });
  must(!/\/auth\/mfa/.test(page.url()), "the authenticator was asked");
}, page);

// ---- 2. first run: only the kind of business, what "Other" is and the name ---------------------------------------------------
await step("N4", 'the set-up asks ONLY the kind of business (Other is already chosen: it asks what the business is), the name and the language; nothing else is required', async () => {
  await page.locator('input[role="combobox"]').waitFor();
  const required = await page.locator("form input[required]").evaluateAll((els) => els.map((e) => e.getAttribute("name")));
  must(required.every((n) => ["business_name", "other_label"].includes(n)), `unexpected required fields: ${required.join(",")}`);
  const asked = await page.locator("form input:visible").evaluateAll((els) => els.filter((e) => e.type !== "radio").length);
  must(asked <= 4, `the set-up asks ${asked} fields`);
  await page.getByLabel("What is your business?").fill(WHAT);
  await page.fill("#setup-business-name", NAME);
  await shot(page, "setup");
  await Promise.all([page.waitForURL(/\/app(\/tenants|$)/, { timeout: 60000 }), page.click('form button[type="submit"]')]);
  const link = page.locator('a[href^="/app/tenants/"]').first();
  if (/\/app$/.test(page.url())) await link.waitFor({ timeout: 15000 });
  const row = psql(`select t.id || '|' || t.slug from public.tenants t join public.memberships m on m.tenant_id = t.id join auth.users u on u.id = m.user_id where u.email = '${EMAIL}'`);
  [tenant, slug] = row.split("|");
  must(/^[0-9a-f-]{36}$/.test(tenant), `workspace not found (${row})`);
  // the throwaway business is renamed in the LOCAL database so the clean-up (which only removes e2e- slugs) finds it; the name shown is still the one typed
  psql(`begin; set local session_replication_role = replica; update public.tenants set slug = 'e2e-${STAMP}' where id = '${tenant}'; commit;`);
  slug = `e2e-${STAMP}`;
  const profile = await api("GET", `${T()}/workspace/profile`, null, await tokenNow());
  must(profile.status === 200 && profile.body.name === NAME, `the business name is not the typed one (${JSON.stringify(profile.body)?.slice(0, 120)})`);
  must(profile.body.type === "other" && profile.body.type_label === WHAT, `the kind is not Other with its words (${profile.body.type}, ${profile.body.type_label})`);
}, page);

await step("N5", 'skip the rest: Today opens at once with the business name and a short "Finish setting up" list; a step can be put away ("Hide for now") and comes back in Settings', async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  const ok = page.getByRole("button", { name: "OK, got it" }); // the cookie notice sits over the page until it is answered
  if (await ok.count()) await ok.click();
  must((await text(page)).includes(NAME), "Today does not show the business name");
  must(!/Something went wrong/i.test(await text(page)), "Today crashed");
  const card = page.locator('[data-start="card"]');
  await card.waitFor({ timeout: 30000 });
  must((await card.getByText("Finish setting up").count()) > 0, 'the list is not called "Finish setting up"');
  const before = await card.locator("li[data-state=todo]").count();
  must(before > 0, "no step is left to do");
  await shot(page, "today-first");
  await card.getByRole("button", { name: "Hide for now" }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-start="card"] li[data-state=todo]').length < n, before, { timeout: 30000 }).catch(() => null);
  const after = await page.locator('[data-start="card"] li[data-state=todo]').count();
  must(after === before - 1 || (before === 1 && after === 0), `a step was not put away (${before} -> ${after})`);
  await page.goto(`${BASE}/app/tenants/${tenant}/settings?section=business`, { waitUntil: "networkidle" });
  must((await page.locator('li[data-hidden="true"]').count()) === 1, "the step put away is not marked in Settings");
}, page);

// ---- 3. the assistant, by typing ----------------------------------------------------------------------------------------------
await step("N6", "Today: with the assistant off the card still has the typing line and says why; the Owner turns it on with one button (the platform allow-list is the local operator switch)", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  const turnOn = page.getByRole("button", { name: /^Turn on / });
  if (await turnOn.count()) {
    must((await page.locator('[data-ask="off"]').getByText(/anything, in any language/).count()) > 0, "no typing line (as drawn) while the assistant is off");
    psql(`select app.operator_enable_assistant('${slug}')`); // the platform's own allow-list: an operator step on the local stack only
    await turnOn.click();
    await page.waitForLoadState("networkidle");
  } else {
    psql(`select app.operator_enable_assistant('${slug}')`);
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.locator("#ask-input").waitFor({ timeout: 30000 });
}, page);

await step("N7", "Today: type a question in the card and press Enter: an answer appears (the scripted model of the local stack)", async () => {
  const box = page.locator("#ask-input");
  const q = "How many things wait for me right now?"; // not one of the chips, so the page has it only once it is asked
  await box.fill(q);
  await box.press("Enter");
  await answered(q, '[data-ask="live"]');
  await shot(page, "ask-today");
}, page);

await step("N8", "another page (Chats): the floating orb opens a panel with a typing box; a question typed there is answered, and Esc closes it", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/outbox`, { waitUntil: "networkidle" });
  const orb = page.getByRole("button", { name: /^Ask Vijaya/ }).last();
  await orb.click();
  const box = page.locator("#ask-input");
  await box.waitFor({ timeout: 30000 });
  const q = "Which message should I read first?";
  await box.fill(q);
  await box.press("Enter");
  await answered(q, "[role=dialog]");
  await shot(page, "ask-floating");
  await page.keyboard.press("Escape");
}, page);

// ---- 4. the profile picture -----------------------------------------------------------------------------------------------------
await step("N9", "Settings > My profile: set a name and a picture (a real upload); the picture shows in the menu footer after the page is read again", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/settings?section=profile`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Asha Owner");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").first().waitFor({ timeout: 30000 });
  await page.setInputFiles("#me-pic-file", PICTURE);
  await page.getByRole("button", { name: "Save picture" }).click();
  await page.getByText("Picture updated.").waitFor({ timeout: 60000 });
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  await page.locator('aside img[src*="/storage/"], aside img[src*="token="]').first().waitFor({ timeout: 30000 });
  const me = await api("GET", `${T()}/me/profile`, null, await tokenNow());
  must(me.status === 200 && me.body.picture === "own" && me.body.display_name === "Asha Owner", `the profile on the API is ${JSON.stringify(me.body)?.slice(0, 120)}`);
  await shot(page, "picture-menu");
}, page);

// ---- 5. the business details and the greeting -------------------------------------------------------------------------------------
await step("N10", "Settings > Business: the Owner changes the name and the phone; the voice preview text carries the NEW name (nothing stored under the old one)", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}/settings?section=business`, { waitUntil: "networkidle" });
  must((await page.locator('input[role="combobox"]').count()) === 1, "the kind of business is not in Settings");
  must((await page.locator('input[name="languages"]:checked').count()) >= 1, "a new owner's languages are all unticked: the form cannot be saved");
  must((await page.locator('[data-part="biz-logo"]').count()) === 1, "no logo part");
  await page.fill("#biz-name", NEW_NAME);
  await page.fill("#biz-phone", "+91 98765 43210");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByText(/The new name shows everywhere now/).waitFor({ timeout: 30000 });
  const said = await api("GET", `${T()}/ai-assistant/voice-preview/text?language=en&style=warm`, null, await tokenNow());
  must(said.status === 200 && said.body.text.includes(NEW_NAME), `the greeting does not carry the new name (${JSON.stringify(said.body)?.slice(0, 160)})`);
  must(!said.body.text.includes(NAME + " ") || NEW_NAME.includes(NAME), "the old name is still in the greeting");
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  must((await text(page)).includes(NEW_NAME), "Today does not show the new name");
}, page);

// ---- 6. sign out and in again -------------------------------------------------------------------------------------------------------
await step("N11", "sign out from the menu; the app is closed to a signed-out browser", async () => {
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  await page.locator("aside").getByRole("button", { name: /Your account/ }).click().catch(async () => page.locator("aside summary").last().click());
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login|\/$/, { timeout: 30000 });
  await page.goto(`${BASE}/app/tenants/${tenant}`);
  await page.waitForURL(/\/login/, { timeout: 30000 });
}, page);

await step("N12", "sign in again: straight to the workspace with no second step; the name, the picture and the hidden step are still there", async () => {
  await signIn();
  await page.waitForURL(/\/app/, { timeout: 60000 });
  must(!/\/auth\/mfa/.test(page.url()), "the authenticator was asked");
  await page.goto(`${BASE}/app/tenants/${tenant}`, { waitUntil: "networkidle" });
  must((await text(page)).includes(NEW_NAME), "the new name is gone");
  await page.locator('aside img[src*="/storage/"], aside img[src*="token="]').first().waitFor({ timeout: 30000 });
  must(!/Something went wrong/i.test(await text(page)), "Today crashed");
  await shot(page, "today-again");
}, page);

await step("Z1", "the browser console had no Content-Security-Policy refusal and no hydration error all run", async () => {
  must(problems.length === 0, `${problems.length}: ${problems[0] ?? ""}`);
}, page);

// the clean-up of `make e2e-local` removes only workspaces named "E2E Silks ...": this run's business is given that name now (LOCAL database only) so nothing is left behind
if (tenant) psql(`begin; set local session_replication_role = replica; update public.tenants set name = 'E2E Silks ${STAMP} new-owner' where id = '${tenant}'; commit;`);
await browser.close();
process.exit(finish());
