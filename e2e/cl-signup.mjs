// Real-stack run of the business-type sign-up (job CL, after job CK): the REAL web (3002), the REAL API (8002) and the LOCAL Supabase (the AGENT stack). Throwaway accounts e2e-<stamp>-*@e2e.example.test, invented data,
// nothing leaves this machine. Run by `make e2e-packs` (it starts and stops the API and the web, with Google and Facebook "configured" by their PUBLIC ids only, and cleans up).
//   for each business type that is not the default (construction materials, education) and for the default one:
//     the two-step sign-up (cards from GET /v1/packs, the buttons GET /v1/auth/providers offers, the terms line) -> e-mail confirmed (local database) -> sign in -> the setup makes the business BY ITSELF with the chosen kind
//     -> Today in that business type's words, the checklist, the example-data offer -> a typed address to a part it does not have answers the 403 page -> business name and city -> load and remove the example data
//     -> the second step (authenticator) from the checklist -> Settings -> Fields: add a field -> it is on the customer form -> a customer with that field's value -> the value is kept
//   then the provider paths that can be run without the owner's Google/Facebook accounts:
//     "Continue with Google" while the Auth server has the provider OFF -> back to step 2 with one sentence;
//     an account made the way Google makes one (no sign-up form, no terms in its metadata, provider google, address verified) -> /setup makes the business by itself from the remembered kind (or asks, with none remembered), the terms recorded at setup with the versions in force.
// A real Google or Facebook round trip needs the owner's own accounts and keys and is NOT run here (docs/runbooks/social-sign-up.md).
// Prints one line per step: PASS or FAIL, and a summary; exit code 1 if any step failed.
import { mkdirSync } from "node:fs";
import path from "node:path";

import "./be-env.mjs";
import { chromium } from "playwright";

import { SHOTS, confirmEmail, factorSecret, passChallenge } from "./lib.mjs";
import { API, BASE, PW, STAMP, SUPABASE_URL, aal2Token, api, gotrue, psql, sharedDatabaseProblem, totp } from "./be-lib.mjs";

mkdirSync(SHOTS, { recursive: true });
const results = [];
let shotN = 0;
const shot = async (page, name) => {
  const p = path.join(SHOTS, `cl-${String(++shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  return p;
};
const must = (cond, what) => {
  if (!cond) throw new Error(what);
};
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const tenants = new Set();
function changedUnderUs() {
  try {
    for (const t of tenants) if (psql(`select count(*) from public.tenants where id = '${t}'`) === "0") return "a workspace of this run is gone: the database was reset by another session";
    return sharedDatabaseProblem();
  } catch {
    return "the database cannot be read (another session is restarting it)";
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
    // the local database is ONE shared thing: another session may reset it, restart it or pin its clock under this run (a pgTAP run restarts its container). Then every later failure is that, not a fault of the product.
    const why = changedUnderUs();
    if (why) {
      console.log(`ABORT ${why}. This is not a fault of the product: run it again when nothing else uses the database.`);
      await browser.close().catch(() => null);
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
const browser = await chromium.launch();
const SLOW = 90_000; // a development server compiles each page the first time it is asked for
const problems = [];
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await context.newPage();
  page.setDefaultTimeout(SLOW);
  page.setDefaultNavigationTimeout(SLOW);
  page.on("console", (m) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following|Hydration failed/i.test(m.text())) problems.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  return { context, page };
};

const cards = await (await fetch(`${API}/v1/packs`)).json();
const IDS = cards.packs.map((p) => p.pack_id);
const providers = await (await fetch(`${API}/v1/auth/providers`)).json();
console.log(`e2e: the API offers ${IDS.join(", ")}; providers ${JSON.stringify(providers)}`);

/** One e-mail sign-up, start to Today, for the card at `index` of the list. Returns what the later steps need. */
async function signUpThrough(index, label) {
  const id = IDS[index];
  const email = `e2e-${STAMP}-${label}@e2e.example.test`;
  const { context, page } = await newContext();
  const out = { id, email, context, page, tenant: "", token: "" };
  await step(`${label}-1`, `step 1 of the sign-up: one searchable list with each business type the API offers, grouped; choosing ${id} goes to step 2 and asks nothing`, async () => {
    await page.goto(`${BASE}/signup`);
    await page.locator('input[role="combobox"]').focus(); // step 1 is one searchable list: it opens on focus
    await page.locator("[data-pack-card]").first().waitFor();
    const listed = await page.locator("[data-pack-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pack-card")));
    must(JSON.stringify([...listed].sort()) === JSON.stringify([...IDS].sort()), "the list is not the API's"); // grouped now ("Built especially for", "Lead Desk", "Other"), so the order is the groups'
    must((await page.locator("input:visible").count()) === 1, "step 1 asks more than the list");
    await shot(page, `${label}-signup-1`);
    await Promise.all([page.waitForURL(new RegExp(`/signup\\?type=${id}$`), { timeout: 30000 }), page.locator(`[data-pack-card="${id}"]`).click()]);
  }, page);
  await step(`${label}-2`, "step 2: the buttons the server offers (Google, Facebook), the e-mail way (an address and a password only) and the terms line with no tick box", async () => {
    must(await page.getByText("By continuing, you agree to the").isVisible(), "no terms line");
    must((await page.locator('input[type="checkbox"]').count()) === 0, "a tick box is there");
    for (const [name, on] of [["Google", providers.google], ["Facebook", providers.facebook]]) must((await page.getByRole("button", { name: `Continue with ${name}` }).count()) === (on ? 1 : 0), `the ${name} button should be ${on ? "there" : "absent"} (the server says ${on})`);
    await page.locator("details[data-signup=email] summary").click();
    must((await page.locator("details[data-signup=email] input:visible").count()) === 2, "the e-mail way asks more than an address and a password");
    await shot(page, `${label}-signup-2`);
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", PW);
    await Promise.all([page.waitForURL(/\/signup\/check-email/, { timeout: 30000 }), page.click('details[data-signup=email] button[type="submit"]')]);
  }, page);
  await step(`${label}-3`, `the e-mail is confirmed, the person signs in, and the setup asks the name only (the kind was chosen at sign-up) and makes the business as ${id}, landing on Today`, async () => {
    const meta = psql(`select raw_user_meta_data->>'business_type' from auth.users where email = '${email}'`);
    must(meta === id, `the account's business_type is "${meta}"`);
    confirmEmail(email);
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/setup/, { timeout: 30000 });
    if (id === "other") await page.getByLabel("What is your business?").fill("Pet grooming (synthetic)"); // Other also asks what the business is
    await page.fill("#setup-business-name", `E2E Silks ${STAMP} ${label}`); // the kind was chosen at sign-up: the set-up asks the name only
    await page.click('form button[type="submit"]');
    await page.waitForURL(/\/app\/tenants\/[0-9a-f-]{36}/, { timeout: 90000 });
    const row = psql(`select t.id || '|' || t.name || '|' || w.pack_code || '|' || w.source from public.tenants t join public.memberships m on m.tenant_id = t.id join auth.users u on u.id = m.user_id join packs.workspace_pack w on w.tenant_id = t.id where u.email = '${email}'`);
    const [tenant, name, code, source] = row.split("|");
    must(code === (id === "other" ? "general_business" : id) && source === "signup" && name === `E2E Silks ${STAMP} ${label}`, `the workspace is "${row}"`);
    // the throwaway workspace is renamed so the clean-up (e2e- slug and "E2E Silks ..." name only) can find it. LOCAL database only.
    psql(`begin; set local session_replication_role = replica; update public.tenants set name = 'E2E Silks ${STAMP} ${label}', slug = 'e2e-${STAMP}-${label}' where id = '${tenant}'; commit;`);
    out.tenant = tenant;
    tenants.add(tenant);
    const accepted = psql(`select string_agg(p.kind || ':' || p.via, ',' order by p.kind) from integrations.policy_acceptances p join auth.users u on u.id = p.user_id where u.email = '${email}'`);
    must(accepted === "privacy:setup,terms:setup", `the acceptances are "${accepted}"`);
    return `${code} (${source}); terms ${accepted}`;
  }, page);
  return out;
}

const labelsOf = async (u) => {
  const token = u.token || (u.token = await aal2Token(u.email));
  return (await api("GET", `/v1/tenants/${u.tenant}/pack`, null, token)).body;
};

/** Today and the rest of the business-type features, for a workspace made by `signUpThrough`. */
async function checkWorkspace(u, label, { offPath }) {
  const { page } = u;
  const T = `${BASE}/app/tenants/${u.tenant}`;
  await step(`${label}-4`, "Today speaks the business type's words (menu, core tab, helpers), shows the checklist and the example-data offer, and offers only the parts its modules switch on", async () => {
    u.token = await aal2Token(u.email).catch(() => "");
    await page.goto(T, { waitUntil: "networkidle" });
    await page.locator('[data-screen="today"]').waitFor();
    const pack = await labelsOf(u).catch(() => null);
    const body = await text(page);
    must((await page.locator('[data-start="card"]').count()) === 1, "the checklist is missing");
    // since the clean-up of 27 Oct a type that ships no example data (the types that start from a lead template) has no offer: the empty button was removed
    const ships = Number(psql(`select coalesce(jsonb_array_length(v.manifest -> 'example_data' -> 'companies'), 0) + coalesce(jsonb_array_length(v.manifest -> 'example_data' -> 'contacts'), 0) from packs.workspace_pack w join packs.pack_versions v on v.code = w.pack_code and v.version = w.pack_version where w.tenant_id = '${u.tenant}'`)) > 0;
    must((await page.locator("[data-example=available]").count()) === (ships ? 1 : 0), ships ? "the example-data offer is missing" : "an empty example-data offer is drawn");
    const links = await page.locator('nav[aria-label="Workspace menu"] a').evaluateAll((els) => els.map((e) => ({ text: (e.textContent ?? "").replace(/\s*Waiting for you:.*$/, "").trim(), path: new URL(e.href).pathname.replace(/^\/app\/tenants\/[0-9a-f-]{36}/, "") })));
    // job DQ part 0: the menu has seven items; the pages of a group are the tabs above its page ("Parts of this section"), so the business type's own words and its parts are looked for in the menu AND in the tabs of every group
    const tabLinks = [];
    for (const l of [...new Map(links.map((x) => [x.path, x])).values()]) {
      if (l.path === "" || l.path === "/") continue;
      await page.goto(`${T}${l.path}`, { waitUntil: "networkidle" });
      tabLinks.push(...(await page.locator('[data-frame="group-tabs"] a').evaluateAll((els) => els.map((e) => ({ text: (e.textContent ?? "").trim(), path: new URL(e.href).pathname.replace(/^\/app\/tenants\/[0-9a-f-]{36}/, "") })))));
    }
    await page.goto(T, { waitUntil: "networkidle" });
    await page.locator('[data-screen="today"]').waitFor();
    const everywhere = [...links, ...tabLinks];
    const menu = everywhere.map((l) => l.text);
    if (pack?.labels?.en) {
      must(menu.includes(pack.labels.en["nav.item.leads"]), `the menu and the tabs have no "${pack.labels.en["nav.item.leads"]}" (${menu.join(" | ")})`);
      must(menu.includes(pack.labels.en["nav.item.customers"]), `the menu has no "${pack.labels.en["nav.item.customers"]}"`);
      // each part is on the menu exactly when its module is on (by where the link goes: a pack may call one part by another's name)
      for (const [module, where] of [["quotes", "/quotes"], ["orders", "/orders"], ["fees", "/fees"], ["campaigns", "/campaigns"], ["catalogue", "/catalogue"]]) {
        const there = everywhere.some((l) => l.path === where);
        must(there === pack.modules.includes(module), `${where} is ${there ? "on the menu" : "missing"} but the module ${module} is ${pack.modules.includes(module) ? "on" : "off"}`);
      }
      must(menu.includes(pack.labels.en["pack.core_tab"]), `the core tab "${pack.labels.en["pack.core_tab"]}" is not on the menu or in a group's tabs`);
    } else must(menu.length > 5, "no menu");
    must(!/saree/i.test(await page.locator("nav").first().innerText()), "the menu says saree");
    await shot(page, `${label}-today`);
    return `${links.length} menu items, ${tabLinks.length} tabs; ${body.includes("Get started") ? "checklist" : "no checklist"}`;
  }, page);

  await step(`${label}-5`, `a typed address to ${offPath} (a part this business type does not have) answers the 403 page, in the frame`, async () => {
    await page.goto(`${T}${offPath}`, { waitUntil: "networkidle" });
    await page.locator('[data-problem="403"]').waitFor();
    must(/not switched on/.test(await page.locator('[data-problem="403"]').innerText()), "the page does not say the part is not switched on");
    must((await page.locator('nav[aria-label="Workspace menu"]').count()) === 1, "the 403 page lost the frame");
    await shot(page, `${label}-403`);
    // the same refusal one level down: a WRITE into a part the business type does not have is refused by the database (SM701), and the API says 403 `module_off`, never a 500
    const pack = await labelsOf(u);
    if (!pack.modules.includes("catalogue")) {
      const item = await api("PUT", `/v1/tenants/${u.tenant}/catalogue/items/${crypto.randomUUID()}`, { name: "E2E probe", fabric: "banarasi", colours: ["pink"], price_band: "5k_10k" }, u.token || (await aal2Token(u.email)));
      must(item.status === 403 && item.body?.error?.code === "module_off", `a catalogue write answered ${item.status} ${JSON.stringify(item.body).slice(0, 120)}`);
      return "web 403 page; API write 403 module_off";
    }
    return "web 403 page";
  }, page);

  await step(`${label}-6`, "business name and city are asked on the Start page, once; the checklist step turns done", async () => {
    await page.goto(`${T}/start`, { waitUntil: "networkidle" });
    await page.fill('input[name="name"]', `E2E Silks ${STAMP} ${label} Traders`); // keeps the name pattern the clean-up looks for ("E2E Silks ...")
    await page.fill('input[name="town"]', "Guntur");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(/Saved|saved/).first().waitFor({ timeout: 30000 });
    const profile = await api("GET", `/v1/tenants/${u.tenant}/profile`, null, u.token || (await aal2Token(u.email)));
    must(profile.status === 200 && profile.body.town === "Guntur" && /Traders$/.test(profile.body.name), `the profile is ${JSON.stringify(profile.body)}`);
    await page.goto(T, { waitUntil: "networkidle" });
    must((await page.locator('[data-step="business_profile"][data-state="done"]').count()) === 1, "step 1 is not done");
  }, page);

  await step(`${label}-7`, "Try with example data: load it (clearly labelled rows, no phone, no e-mail), then remove it with one confirming press (only for a type that ships some)", async () => {
    await page.goto(T, { waitUntil: "networkidle" });
    if ((await page.getByRole("button", { name: "Load example data" }).count()) === 0) return "no example data for this type: no offer";
    await page.getByRole("button", { name: "Load example data" }).click();
    await page.locator("[data-example=loaded]").waitFor({ timeout: 60000 });
    const countRows = () => psql(`select (select count(*) from public.companies where tenant_id = '${u.tenant}' and name like 'Example: %') || '|' || (select count(*) from public.contacts where tenant_id = '${u.tenant}' and full_name like 'Example: %') || '|' || (select count(*) from public.contacts where tenant_id = '${u.tenant}' and full_name like 'Example: %' and (email is not null or phone is not null))`);
    // the rows are written by the API a moment before the screen says "loaded" on a busy machine: look again for a few seconds before judging
    let rows = countRows();
    for (let k = 0; k < 6 && rows.startsWith("0|0|"); k++) {
      await page.waitForTimeout(500);
      rows = countRows();
    }
    const [companies, contacts, withContact] = rows.split("|").map(Number);
    // night 4: the nine "any business with leads" types ship NO example data (they start from a lead template), so for them a load makes an empty batch; the three deep types must make rows
    const planned = Number(psql(`select coalesce(jsonb_array_length(v.manifest -> 'example_data' -> 'companies'), 0) + coalesce(jsonb_array_length(v.manifest -> 'example_data' -> 'contacts'), 0) from packs.workspace_pack w join packs.pack_versions v on v.code = w.pack_code and v.version = w.pack_version where w.tenant_id = '${u.tenant}'`));
    must(withContact === 0 && (planned > 0 ? companies + contacts > 0 : companies + contacts === 0), `sample rows: ${rows} (the pack plans ${planned})`);
    await shot(page, `${label}-example-loaded`);
    await page.locator("details summary", { hasText: "Remove example data" }).click();
    await page.getByRole("button", { name: "Yes, remove the example data" }).click();
    await page.locator("[data-example=available]").waitFor({ timeout: 60000 });
    const left = psql(`select (select count(*) from public.companies where tenant_id = '${u.tenant}' and name like 'Example: %') + (select count(*) from public.contacts where tenant_id = '${u.tenant}' and full_name like 'Example: %')`);
    must(left === "0", `${left} sample rows left`);
    return `loaded ${companies} companies and ${contacts} contacts, removed`;
  }, page);

  await step(`${label}-8`, "the second step is asked from the checklist, not at sign-up: enrol an authenticator, sign in with the code, and the step turns done", async () => {
    await page.goto(T, { waitUntil: "networkidle" });
    must((await page.locator('[data-step="second_factor_set"][data-state="todo"]').count()) === 1, "the second-step item is not on the checklist");
    must((await page.locator('[data-step="second_factor_set"] a').getAttribute("href")) === "/app/security", "it does not go to Security");
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
    await u.context.clearCookies();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', u.email);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/auth\/mfa/, { timeout: 30000 });
    await passChallenge(page, u.email);
    u.token = await aal2Token(u.email);
    await page.goto(T, { waitUntil: "networkidle" });
    must((await page.locator('[data-step="second_factor_set"][data-state="done"]').count()) === 1, "the second-step item is not done");
  }, page);

  await step(`${label}-9`, "Settings → Fields: add a field of our own; it is on the customer form; a customer saved with its value keeps it (checked in the API)", async () => {
    await page.goto(`${T}/settings?section=fields`, { waitUntil: "networkidle" });
    await page.locator("[data-part=fields]").waitFor();
    must((await page.getByText("From your business type").count()) >= 1, "the business type's own fields are not listed");
    const add = page.getByRole("region", { name: "Add a field" });
    await add.getByLabel("Add it to").selectOption("contact");
    await add.getByLabel("Name of the field").fill("Gate code");
    await add.getByRole("button", { name: "Add field" }).click();
    await page.getByRole("status").first().waitFor({ timeout: 60000 });
    must((await page.locator("[data-field='gate_code']").count()) === 1, "the new field is not listed");
    // change it: its name and 'required' (Edit), checked in the API; then put the name back
    const row = page.locator("[data-field='gate_code']");
    await row.locator("summary", { hasText: "Edit" }).click();
    await row.locator("input[name=label]").fill("Gate code (night)");
    await row.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/fieldnote=updated/, { timeout: 60000 });
    const defs = await api("GET", `/v1/tenants/${u.tenant}/custom-fields?entity=contact`, null, u.token || (await aal2Token(u.email)));
    const changed = (defs.body?.fields ?? []).find((f) => f.code === "gate_code");
    must(changed?.label?.en === "Gate code (night)", `the API says ${JSON.stringify(changed?.label)}`);
    await page.locator("[data-field='gate_code']").locator("summary", { hasText: "Edit" }).click();
    await page.locator("[data-field='gate_code'] input[name=label]").fill("Gate code");
    await page.locator("[data-field='gate_code']").getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/fieldnote=updated/, { timeout: 60000 });
    await page.goto(`${T}/customers/new`, { waitUntil: "networkidle" });
    await page.locator("[data-part=custom-fields]").waitFor();
    const withCompanies = (await labelsOf(u)).modules.includes("companies");
    await page.fill("#cust-name", `E2E ${label} Customer`);
    await page.fill("#cust-phone", "+00 90000 20099");
    await page.getByLabel("Gate code").fill("4711");
    await page.getByRole("button", { name: "Add this customer" }).click();
    if (!withCompanies) {
      // this business type has no companies, and the form makes a company first: it says so in one sentence (not "your role cannot"), and nothing is made. The parents and students form is job CR/CS.
      const alert = page.locator("form [role=alert]"); // not the framework's own empty route announcer
      await alert.waitFor({ timeout: 60000 });
      must(/does not use this form/.test(await alert.innerText()), `the sentence is "${await alert.innerText()}"`);
      must(psql(`select count(*) from public.contacts where tenant_id = '${u.tenant}' and full_name = 'E2E ${label} Customer'`) === "0", "a contact was made");
      await shot(page, `${label}-custom-field-no-companies`);
      return "the field is on the form; the form is switched off for a business type with no companies (said plainly)";
    }
    // wait for the form's OWN answer (the status message after it saved), not for any text on the page that happens to say "saved": the customer, its lead and its custom values are saved in steps, and a check made before the
    // last one finds the contact without its value (job DG: this race was the con-9 failure that appeared once the web got slower to answer than it used to be)
    await page.getByRole("status").filter({ hasText: /Added/ }).first().waitFor({ timeout: 60000 });
    const token = u.token || (await aal2Token(u.email));
    const contact = psql(`select id from public.contacts where tenant_id = '${u.tenant}' and full_name = 'E2E ${label} Customer'`);
    const values = await api("GET", `/v1/tenants/${u.tenant}/contacts/${contact}/custom`, null, token);
    const got = (values.body?.values ?? []).find((v) => v.code === "gate_code");
    must(values.status === 200 && got?.value === "4711", `the API says ${JSON.stringify(values.body).slice(0, 200)}`);
    await shot(page, `${label}-custom-field`);
  }, page);
}

// ---- 1. the business types, by e-mail ------------------------------------------------------------------------------------------------
const others = IDS.map((id, i) => ({ id, i })).filter((x) => x.i > 0);
const OFF = { construction_materials: "/fees", education: "/orders" };
for (const { id, i } of others) {
  const label = id.startsWith("con") ? "con" : id.startsWith("edu") ? "edu" : `p${i}`;
  const u = await signUpThrough(i, label);
  if (u.tenant) await checkWorkspace(u, label, { offPath: OFF[id] ?? "/fees" });
  await u.context.close();
}

// ---- 2. the default business type by e-mail: the same sign-up, a checklist instead of the saree wizard for a NEW business ---------------------------------------
{
  const u = await signUpThrough(0, "txt");
  if (u.tenant) {
    await step("txt-4", "the default business type, chosen at sign-up, also gets the checklist (blueprint 3.3), with products, quote rules, the second step, WhatsApp and the first quote", async () => {
      await u.page.goto(`${BASE}/app/tenants/${u.tenant}`, { waitUntil: "networkidle" });
      await u.page.locator('[data-start="card"]').waitFor();
      const steps = await u.page.locator("[data-step]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step")));
      must(JSON.stringify(steps) === JSON.stringify(["business_profile", "catalogue_has_items", "quote_rules_set", "second_factor_set", "whatsapp_connected", "first_quote_sent"]), `the steps are ${steps.join(",")}`);
      await shot(u.page, "txt-today");
    }, u.page);
  }
  await u.context.close();
}

// ---- 3. Google and Facebook: what can be run without the owner's own accounts --------------------------------------------------------------------------
{
  const { context, page } = await newContext();
  await step("G1", "'Continue with Google' while the Auth server has the provider OFF: back to step 2 with one plain sentence, nothing created", async () => {
    if (!providers.google) return "skipped: the API offers no Google button in this run";
    const before = psql("select count(*) from auth.users");
    await page.goto(`${BASE}/signup?type=${IDS[1]}`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/signup\?type=.*error=provider/, { timeout: 30000 });
    must(/not available yet/.test(await text(page)), "no sentence");
    must(psql("select count(*) from auth.users") === before, "an account was made");
    must(!(await context.cookies()).some((c) => c.name === "sb-127-auth-token"), "a session was made");
    await shot(page, "google-off");
    return "Auth server refused the provider; the page says so";
  }, page);

  // a Google-like account, made in the local database the way the provider's callback would leave it (no sign-up form, no terms, provider google, address verified)
  const googleLike = async (suffix) => {
    const email = `e2e-${STAMP}-${suffix}@e2e.example.test`;
    const made = await gotrue("POST", "/auth/v1/signup", { email, password: PW });
    must(made.status === 200, `the local Auth server said ${made.status}`);
    confirmEmail(email);
    psql(`update auth.users set raw_app_meta_data = '{"provider":"google","providers":["google"]}'::jsonb where email = '${email}'; update auth.identities set provider = 'google', identity_data = identity_data || '{"email_verified": true}'::jsonb where user_id = (select id from auth.users where email = '${email}')`);
    return email;
  };
  const finish = async (p, email, suffix, wantCode) => {
    const row = psql(`select t.id || '|' || w.pack_code || '|' || w.source from public.tenants t join public.memberships m on m.tenant_id = t.id join auth.users u on u.id = m.user_id join packs.workspace_pack w on w.tenant_id = t.id where u.email = '${email}'`);
    const [tenant, code, source] = row.split("|");
    must(code === wantCode && source === "signup", `the workspace is ${row}`);
    const accepted = psql(`select string_agg(p.kind || ':' || p.via, ',' order by p.kind) from integrations.policy_acceptances p join auth.users u on u.id = p.user_id where u.email = '${email}'`);
    must(accepted === "privacy:setup,terms:setup", `the acceptances are "${accepted}"`);
    psql(`begin; set local session_replication_role = replica; update public.tenants set name = 'E2E Silks ${STAMP} ${suffix}', slug = 'e2e-${STAMP}-${suffix}' where id = '${tenant}'; commit;`);
    tenants.add(tenant);
    await shot(p, `${suffix}-today`);
    return `${code}; terms ${accepted}`;
  };
  await step("G2", "after the trip to Google (the kind of business was remembered in the browser): the Google-like account lands on /setup, which asks the name and makes the business with that kind and records the terms at setup", async () => {
    const email = await googleLike("goo");
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/setup/, { timeout: 30000 });
    await page.fill("#setup-business-name", `E2E Silks ${STAMP} goo`); // the remembered kind is already chosen: the name is the only thing asked
    await page.click('form button[type="submit"]');
    await page.waitForURL(/\/app\/tenants\/[0-9a-f-]{36}/, { timeout: 90000 });
    return finish(page, email, "goo", IDS[1]);
  }, page);
  await context.close();

  // a visitor with no remembered choice (another browser, the cookie gone): /setup asks the kind
  const second = await newContext();
  await step("G3", "a Google-like account with no remembered choice: /setup asks the kind of business (cards from the API), the business is made with the chosen one, the terms are recorded at setup", async () => {
    const email = await googleLike("goq");
    const p = second.page;
    await p.goto(`${BASE}/login`);
    await p.fill('input[name="email"]', email);
    await p.fill('input[name="password"]', PW);
    await p.click('button:has-text("Sign in")');
    await p.waitForURL(/\/setup/, { timeout: 30000 });
    must((await p.locator('input[role="combobox"]').count()) === 1, "the setup does not ask the kind of business (one searchable list)");
    await p.locator('input[role="combobox"]').focus();
    await p.locator(`[data-pack-card="${IDS[2]}"]`).waitFor();
    await shot(p, "google-setup-asks");
    await p.locator(`[data-pack-card="${IDS[2]}"]`).click();
    await p.fill("#setup-business-name", `E2E Silks ${STAMP} goq`);
    await Promise.all([p.waitForURL(/\/app\/tenants\/[0-9a-f-]{36}/, { timeout: 90000 }), p.click('form button[type="submit"]')]);
    return finish(p, email, "goq", IDS[2]);
  }, second.page);
  await second.context.close();
}

await browser.close();
const failed = results.filter((r) => r.status === "FAIL");
console.log(`\ne2e: ${results.length - failed.length} passed, ${failed.length} failed`);
if (problems.length) console.log(`browser problems:\n${[...new Set(problems)].slice(0, 8).join("\n")}`);
void SUPABASE_URL;
void factorSecret;
process.exit(failed.length || problems.length ? 1 : 0);
