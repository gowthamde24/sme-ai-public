// Job CC (the screens for the new APIs) in the real-stack run: the real web (3002), the real API (8002), the local Supabase stack, a real browser. Steps CC1 and on; each one is a screen of the job.
// The API's providers are the ones of the local stack: WhatsApp is the FAKE channel, web search and the places search are the API's own fakes, nothing leaves this machine. Run only these with E2E_ONLY=CC (see be-stack.mjs).
import path from "node:path";

import { gotrue } from "./be-lib.mjs";
import { PW, confirmEmail } from "./lib.mjs";

/** The page on a phone (360 px) and in the dark: no sideways scroll, targets >= 44 px, text >= 14 px, no accessibility violation. Restores the desktop view. Returns the list of problems (empty = clean). */
export async function phoneAudit(c, label) {
  const { page, SHOTS, measure, axeOf } = c;
  const seen = [];
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  try {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${label}-phone-dark.png`), fullPage: true });
    const m = await measure(page);
    if (m.scrollW > m.clientW) seen.push(`sideways scroll ${m.scrollW}>${m.clientW}`);
    if (m.bad.length) seen.push(`small targets ${m.bad.join("; ")}`);
    if (m.small.length) seen.push(`small text ${m.small.join("; ")}`);
    const v = await axeOf(page);
    if (v.length) seen.push(`axe ${v.join(", ")}`);
  } finally {
    await page.emulateMedia({ colorScheme: null, reducedMotion: null }).catch(() => null);
    await page.setViewportSize({ width: 1280, height: 900 }).catch(() => null);
  }
  return seen;
}

const BASE_OF = (c) => c.BASE;

export async function ccSteps(c) {
  const { step, page, must, text, BASE, SHOTS, SLOW, psql, api, aal2Token } = c;
  const base = () => `${BASE}/app/tenants/${c.tenant}`;
  const stamp = Date.now().toString(36);

  // ---- CC1. Settings > Data -------------------------------------------------------------------------------------------------------------------------------------
  await step("CC1", "Settings > Data: import a spreadsheet (one customer with only a phone, one with nothing) with the preview and the mapping, import it once, export a file, make and stop the calendar address", async () => {
    await page.goto(`${base()}/settings?section=data`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Bring in a spreadsheet" }).waitFor();
    for (const name of ["Send your books to your accountant", "Visits in your phone's calendar"]) must((await page.getByRole("heading", { name }).count()) === 1, `no part named ${name}`);
    await page.screenshot({ path: path.join(SHOTS, "CC1-data-desktop.png"), fullPage: true });

    // the import: a Tally-style party list with a phone-only customer (a +00 test number: the real-data gate is closed) and one with no phone or e-mail
    const csv = `Party Name,Mobile,Town\nE2E Alpha Silks ${stamp},+00 98765 45551,Guntur\nE2E Beta Silks ${stamp},,Vijayawada\n`;
    await page.getByRole("radio", { name: "Tally", exact: true }).check();
    await page.getByLabel("Choose the file").setInputFiles({ name: "parties.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByRole("heading", { name: "Which column is which?" }).waitFor();
    must((await page.getByLabel(/Customer or shop name/).inputValue()) === "0", "the name column was not guessed");
    must((await page.getByLabel(/Phone or WhatsApp number/).inputValue()) === "1", "the phone column was not guessed");
    await page.screenshot({ path: path.join(SHOTS, "CC1-data-mapping.png"), fullPage: true });
    await page.getByRole("button", { name: "Show what would happen" }).click();
    await page.getByRole("heading", { name: "What would happen" }).waitFor();
    const preview = await text(page);
    must(preview.includes("Would be added") && preview.includes(`E2E Alpha Silks ${stamp}`) && preview.includes(`E2E Beta Silks ${stamp}`), "the preview does not list both customers");
    must(preview.includes("No phone number or e-mail: the shop is added without a person."), "the note for the customer without a phone was not shown");
    await page.screenshot({ path: path.join(SHOTS, "CC1-data-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText("Import finished").waitFor();
    must(psql(`select count(*) from public.companies where tenant_id = '${c.tenant}' and name like 'E2E % Silks ${stamp}'`) === "2", "the two shops were not imported");
    must(Number(psql(`select count(*) from public.contacts where tenant_id = '${c.tenant}' and phone like '%98765 45551%'`)) === 1, "the phone-only contact was not imported");
    await page.screenshot({ path: path.join(SHOTS, "CC1-data-imported.png"), fullPage: true });

    // the same file again: everyone is already there, nothing can be imported twice
    await page.getByRole("button", { name: "Import another file" }).click();
    await page.getByLabel("Choose the file").setInputFiles({ name: "parties.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByRole("button", { name: "Show what would happen" }).click();
    await page.getByRole("heading", { name: "What would happen" }).waitFor();
    must((await page.getByRole("button", { name: "Import", exact: true }).isDisabled()) === true, "a second import of the same people was allowed");
    must((await text(page)).includes("Already in your list"), "the second preview did not say they are already there");

    // the export: a CSV for last month (there may be no sales: the screen says so)
    await page.getByRole("radio", { name: "Spreadsheet (CSV)" }).check();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the file" }).click()]);
    must(/\.csv$/.test(download.suggestedFilename()), `the export file is called ${download.suggestedFilename()}`);
    await page.getByRole("status").filter({ hasText: /downloaded|no sales or payments/ }).first().waitFor();

    // the calendar address: made, shown once, works, a new one stops the old one, stopping stops it
    await page.getByRole("button", { name: "Make my calendar address" }).click();
    const first = (await page.locator("[data-calendar-address]").innerText()).trim();
    must(/\/v1\/calendar\/feed\/[A-Za-z0-9_-]{16,}\.ics$/.test(first), `the address is ${first}`);
    const get = async (u) => fetch(u.replace(/^webcal:/, "http:"));
    const r1 = await get(first);
    must(r1.status === 200 && /text\/calendar/.test(r1.headers.get("content-type") || "") && (await r1.text()).includes("BEGIN:VCALENDAR"), `the calendar address answered ${r1.status}`);
    await page.screenshot({ path: path.join(SHOTS, "CC1-data-calendar.png"), fullPage: true });
    const audit = await phoneAudit(c, "CC1-data");
    await page.getByRole("button", { name: "Make a new address" }).click();
    await page.waitForFunction((old) => { const el = document.querySelector("[data-calendar-address]"); return el && el.textContent.trim() !== old; }, first);
    const second = (await page.locator("[data-calendar-address]").innerText()).trim();
    must((await get(first)).status === 404, "the old address still works after a new one was made");
    must((await get(second)).status === 200, "the new address does not work");
    await page.getByRole("button", { name: "Stop this address" }).click();
    await page.getByText("The address no longer works.").waitFor();
    must((await get(second)).status === 404, "a stopped address still works");
    await page.reload({ waitUntil: "networkidle" });
    must((await text(page)).includes("You do not have a calendar address yet."), "the page does not say there is no address");
    must(audit.length === 0, `phone: ${audit.join(" | ")}`);
    return "import (mapping, preview, phone-only customer), a second import is refused as duplicates, CSV export, calendar address made / rotated / stopped; phone and dark clean";
  }, page);

  // ---- CC2. Settings > Privacy ----------------------------------------------------------------------------------------------------------------------------------
  await step("CC2", "Settings > Privacy: prepare and download my data (a real zip from real Storage), the consent list, the only owner cannot delete the account, the workspace deletion is scheduled for 14 days and cancelled", async () => {
    await page.goto(`${base()}/settings?section=privacy`, { waitUntil: "networkidle" });
    for (const name of ["Download my data", "Delete my account", "Delete this workspace", "Consent and opt-out list", "More privacy tools"]) await page.getByRole("heading", { name }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, "CC2-privacy-desktop.png"), fullPage: true });

    // my data: made in the background, looked at again, then downloaded (a signed link that works once for five minutes)
    await page.getByRole("button", { name: "Prepare my file" }).click();
    await page.locator('[data-privacy="export"]').getByText("Ready", { exact: true }).waitFor({ timeout: 90000 });
    await page.screenshot({ path: path.join(SHOTS, "CC2-privacy-export-ready.png"), fullPage: true });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: "Download", exact: true }).click()]);
    const file = await download.path();
    const { readFileSync, statSync } = await import("node:fs");
    must(statSync(file).size > 100, "the downloaded file is empty");
    must(readFileSync(file).subarray(0, 2).toString() === "PK", "the downloaded file is not a zip");

    // the consent list counts the customers the earlier steps made
    const consent = page.locator('[data-privacy="consent"]');
    await consent.getByText(/Looked at (all|the first) \d+ customers/).waitFor();

    // the only owner cannot delete the account: the typed e-mail is accepted by the button, the API refuses, the page says why and keeps what was typed
    const mine = page.locator('[data-privacy="delete-account"]');
    const button = mine.getByRole("button", { name: "Delete my account" });
    must(await button.isDisabled(), "the delete button was on before anything was typed");
    await mine.getByLabel(/Type your e-mail address/).fill("someone-else@e2e.example.test");
    must(await button.isDisabled(), "the delete button was on for the wrong e-mail");
    await mine.getByLabel(/Type your e-mail address/).fill(c.email.toUpperCase());
    await button.click();
    await mine.getByRole("alert").filter({ hasText: "only owner of a workspace" }).waitFor();
    must((await mine.getByLabel(/Type your e-mail address/).inputValue()) === c.email.toUpperCase(), "what was typed was lost");

    // the workspace: scheduled for 14 days (nothing is erased), shown with its day, cancelled
    const space = page.locator('[data-privacy="delete-workspace"]');
    await space.getByLabel(/Type the workspace name/).fill("wrong name");
    must(await space.getByRole("button", { name: "Delete this workspace" }).isDisabled(), "the workspace delete button was on for a wrong name");
    const name = psql(`select name from public.tenants where id = '${c.tenant}'`);
    await space.getByLabel(/Type the workspace name/).fill(name);
    await space.getByRole("button", { name: "Delete this workspace" }).click();
    await space.getByText("Deletion is scheduled").waitFor();
    must(psql(`select count(*) from public.tenants where id = '${c.tenant}'`) === "1", "the workspace was removed at once");
    await page.screenshot({ path: path.join(SHOTS, "CC2-privacy-scheduled.png"), fullPage: true });
    const audit = await phoneAudit(c, "CC2-privacy");
    await space.getByRole("button", { name: "Cancel the deletion" }).click();
    await space.getByText("Cancelled. Nothing will be deleted.").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    must((await page.locator('[data-privacy="delete-workspace"]').getByText("Deletion is scheduled").count()) === 0, "the cancelled deletion is still shown");
    must(audit.length === 0, `phone: ${audit.join(" | ")}`);
    return "export made and downloaded as a zip, consent list read, sole owner refused with words, workspace deletion scheduled and cancelled; phone and dark clean";
  }, page);

  // ---- CC3. Find retailers --------------------------------------------------------------------------------------------------------------------------------------
  await step("CC3", "Find retailers: the page and its status, a real search through Agent OWL, a shop kept as a lead from what is typed (real places/confirm), the same shop twice is one lead", async () => {
    await page.goto(`${base()}/retailers`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Find retailers" }).waitFor();
    must((await text(page)).includes("Map search is on."), `the status says: ${(await page.locator("[data-retailers-status]").innerText()).slice(0, 80)}`);
    await page.screenshot({ path: path.join(SHOTS, "CC3-retailers-desktop.png"), fullPage: true });

    // a real search: the question goes to Agent OWL of the local stack (its scripted model does not use the map tool, so there may be no cards: the page must still answer)
    await page.getByLabel("City or town").fill("Guntur");
    await page.getByRole("button", { name: "Search" }).click();
    await page.locator("[data-retailers-results]").waitFor({ timeout: 60000 });
    must(!(await text(page)).includes("Could not"), "the real search ended in an error");
    await page.screenshot({ path: path.join(SHOTS, "CC3-retailers-real-search.png"), fullPage: true });

    // the cards: the search route answers two shops (as it would when the map tool is used); saving them goes to the real API
    const ids = ["3b1c0000-0000-4000-8000-" + stamp.padEnd(12, "0").slice(0, 12), "3b1c0000-0000-4000-8000-" + ("f" + stamp).padEnd(12, "0").slice(0, 12)];
    await page.route("**/retailers/search", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { cards: [{ id: ids[0], label: "Balaji Sarees (map)", url: "https://maps.google.com/?cid=2" }, { id: ids[1], label: "Second Silks (map)", url: null }], text: "I found two shops (see the cards).", error: null } }) }));
    await page.getByRole("button", { name: "Search" }).click();
    const cards = page.locator("[data-place]");
    await cards.first().waitFor();
    must((await cards.count()) === 2, "the two cards are not shown");
    must((await cards.first().innerText()).includes("From Google Maps"), "no attribution on the card");
    must((await cards.first().getByRole("link", { name: "View on Google Maps" }).getAttribute("rel")) === "noopener noreferrer", "the Maps link is not safe");
    await cards.first().getByRole("button", { name: "Add as a lead" }).click();
    must((await cards.first().getByLabel("Shop name").inputValue()) === "", "the shop name was prefilled from the map");
    await cards.first().getByLabel("Shop name").fill(`E2E Balaji ${stamp}`);
    await cards.first().getByRole("button", { name: "Save as a lead" }).click();
    await cards.first().getByText("Saved as a lead.").waitFor();
    const lead = psql(`select l.id || '|' || l.source from public.leads l join public.companies c on c.id = l.company_id where l.tenant_id = '${c.tenant}' and c.name = 'E2E Balaji ${stamp}'`);
    must(lead.endsWith(`|places:${ids[0]}`), `the lead is ${lead}`);
    const href = await cards.first().getByRole("link", { name: "Open the lead" }).getAttribute("href");
    must(href === `/app/tenants/${c.tenant}/leads/${lead.split("|")[0]}`, `the link goes to ${href}`);

    // the same shop again (a new search shows the cards again): one lead
    await page.getByRole("button", { name: "Search" }).click();
    await cards.first().waitFor();
    await cards.first().getByRole("button", { name: "Add as a lead" }).click();
    await cards.first().getByLabel("Shop name").fill(`E2E Balaji ${stamp}`);
    await cards.first().getByRole("button", { name: "Save as a lead" }).click();
    await cards.first().getByText("This shop was already saved as a lead.").waitFor();
    must(psql(`select count(*) from public.leads where tenant_id = '${c.tenant}' and source = 'places:${ids[0]}'`) === "1", "the same shop became two leads");
    await page.screenshot({ path: path.join(SHOTS, "CC3-retailers-cards.png"), fullPage: true });
    const audit = await phoneAudit(c, "CC3-retailers");
    await page.unroute("**/retailers/search");
    must(audit.length === 0, `phone: ${audit.join(" | ")}`);
    return "status, a real search answered, two cards with attribution, a lead made from typed details (source places:<id>), the same shop saved twice is one lead; phone and dark clean";
  }, page);

  // ---- CC4. Team ------------------------------------------------------------------------------------------------------------------------------------------------
  await step("CC4", "Team: the people with their owls, an invitation code shown once, a second person joins with it from the link (the code leaves the address bar), the owner changes their role and removes them", async () => {
    await page.goto(`${base()}/team`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
    must((await page.locator("[data-team=members] svg.owl").count()) >= 1, "no owl on the owner's row");
    must((await text(page)).includes("(you)"), "'you' is not marked");
    must((await text(page)).includes("Owners are added by the operator, not here."), "the owner note is missing");
    await page.screenshot({ path: path.join(SHOTS, "CC4-team-desktop.png"), fullPage: true });

    // an invitation: the code is shown once, with the join address carrying it after a #
    await page.getByLabel("Role", { exact: true }).first().selectOption("sales");
    await page.getByLabel(/Label/).fill("for the e2e cutter");
    await page.getByRole("button", { name: "Make an invitation code" }).click();
    const code = (await page.locator("[data-invite-code]").innerText()).trim();
    must(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(code), `the code looks like ${code}`);
    must((await text(page)).includes("Give this code to the person yourself."), "the warning is missing");
    must((await page.getByRole("link", { name: "Send by WhatsApp" }).getAttribute("href")).startsWith("https://wa.me/?text="), "the WhatsApp link is not a share link");
    must((await text(page)).includes(`/app/join#code=${code}`), "the join address does not carry the code");
    await page.screenshot({ path: path.join(SHOTS, "CC4-team-invited.png"), fullPage: true });
    const audit = await phoneAudit(c, "CC4-team");
    // the code is stored as a hash only
    must(psql(`select count(*) from public.invitations where tenant_id = '${c.tenant}' and status = 'pending'`) === "1", "the invitation is not in the database");
    must(!psql(`select row_to_json(i)::text from public.invitations i where tenant_id = '${c.tenant}' limit 1`).includes(code), "the code is stored in the clear");

    // a second person: a new account, signed in a new browser, opens the link
    const second = `e2e-join-${stamp}@e2e.example.test`;
    const made = await gotrue("POST", "/auth/v1/signup", { email: second, password: PW });
    must(made.status === 200, `could not make the second account (HTTP ${made.status})`);
    confirmEmail(second);
    const ctx2 = await c.browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(c.SLOW);
    p2.setDefaultNavigationTimeout(c.SLOW);
    try {
      await p2.goto(`${BASE_OF(c)}/login`);
      await p2.fill('input[name="email"]', second);
      await p2.fill('input[name="password"]', PW);
      await p2.click('button:has-text("Sign in")');
      await p2.waitForURL(/\/(setup|app)/, { timeout: 30000 });
      await p2.goto(`${BASE_OF(c)}/app/join#code=${code}`);
      await p2.getByRole("heading", { level: 1, name: "Join a business" }).waitFor();
      await p2.waitForFunction(() => document.querySelector("input")?.value !== "");
      must((await p2.getByLabel("Invitation code").inputValue()) === code, "the code was not taken from the link");
      must(!p2.url().includes("#"), `the code is still in the address bar: ${p2.url()}`);
      await p2.screenshot({ path: path.join(SHOTS, "CC4-join.png"), fullPage: true });
      await p2.getByRole("button", { name: "Join", exact: true }).click();
      await p2.waitForURL(new RegExp(`/app/tenants/${c.tenant}`), { timeout: 60000 });
      // a wrong code is one plain answer
      await p2.goto(`${BASE_OF(c)}/app/join`);
      await p2.getByLabel("Invitation code").fill("AAAAA-BBBBB-CCCCC-DDDDD");
      await p2.getByRole("button", { name: "Join", exact: true }).click();
      await p2.getByRole("alert").filter({ hasText: "That code is not valid" }).waitFor();
    } finally {
      await ctx2.close();
    }
    must(psql(`select count(*) from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = '${c.tenant}' and u.email = '${second}' and m.role = 'sales'`) === "1", "the second person is not a Sales member");

    // the owner sees the new member, changes the role, then removes them with a reason
    await page.reload({ waitUntil: "networkidle" });
    const rows = page.locator("[data-team=members] li");
    must((await rows.count()) === 2, `the team has ${await rows.count()} people`);
    const row = page.locator('[data-team=members] li[data-member="sales"]');
    await row.getByLabel("Role").selectOption("viewer");
    await row.getByRole("button", { name: "Change role" }).click();
    await page.getByText("Role changed.").waitFor();
    must(psql(`select m.role from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = '${c.tenant}' and u.email = '${second}'`) === "viewer", "the role was not changed");
    const viewer = page.locator('[data-team=members] li[data-member="viewer"]');
    await viewer.getByRole("button", { name: "Remove" }).click();
    await viewer.getByLabel("Why?").selectOption("access_no_longer_needed");
    await viewer.getByRole("button", { name: "Yes, remove" }).click();
    await page.getByText(/Removed\. \d+ leads and \d+ opportunities now have no owner/).waitFor();
    must(psql(`select count(*) from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = '${c.tenant}' and u.email = '${second}'`) === "0", "the person is still a member");
    // the invitation list shows it was used
    await page.reload({ waitUntil: "networkidle" });
    must((await page.locator("[data-team=invitations]").innerText()).includes("Used"), "the invitation does not show as used");
    must(audit.length === 0, `phone: ${audit.join(" | ")}`);
    return "owls, one-time code (stored as a hash), joined from the link with the code taken out of the address bar, a wrong code refused in words, role changed, member removed; phone and dark clean";
  }, page);

  // ---- CC5. WhatsApp: Connect and the customer chats ------------------------------------------------------------------------------------------------------------
  await step("CC5", "WhatsApp: Connect shows the four states against the local fake channel; a customer chat shows their message and ours with the reason in words, the owner approves one (= send) and replies", async () => {
    // Connect: not connected -> connecting (saved) -> connected -> needs attention (switched off) -> connected
    await page.goto(`${base()}/integrations/whatsapp`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Connect WhatsApp" }).waitFor();
    const stateOf = async () => (await page.locator("[data-wa-state]").getAttribute("data-wa-state")) ?? "";
    must((await stateOf()) === "not_connected", `the first state is ${await stateOf()}`);
    await page.screenshot({ path: path.join(SHOTS, "CC5-connect-not-connected.png"), fullPage: true });
    await page.getByLabel("WhatsApp Business account ID").fill("123456789012345");
    await page.getByLabel("Phone number ID").fill("109876543210987");
    await page.getByLabel(/Number customers see/).fill("+91 98765 43210");
    await page.getByLabel("Name of the access key").fill("SHOP_E2E_TOKEN");
    await page.getByRole("button", { name: "Save details" }).click();
    await page.locator('[data-wa-state="connecting"]').waitFor();
    await page.screenshot({ path: path.join(SHOTS, "CC5-connect-connecting.png"), fullPage: true });
    await page.getByRole("button", { name: "Switch on" }).click();
    await page.locator('[data-wa-state="connected"]').waitFor();
    await page.screenshot({ path: path.join(SHOTS, "CC5-connect-connected.png"), fullPage: true });
    const token = await aal2Token();
    const acct = await api("GET", `/v1/tenants/${c.tenant}/whatsapp/account`, null, token);
    must(acct.status === 200 && acct.body.status === "active" && acct.body.token_available === true, `the API says ${JSON.stringify(acct.body).slice(0, 160)}`);
    await page.getByRole("button", { name: "Switch off" }).click();
    await page.locator('[data-wa-state="needs_attention"]').waitFor();
    await page.screenshot({ path: path.join(SHOTS, "CC5-connect-needs-attention.png"), fullPage: true });
    await page.getByRole("button", { name: "Switch on" }).click();
    await page.locator('[data-wa-state="connected"]').waitFor();
    // the Integrations page links to it
    await page.goto(`${base()}/integrations`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Connect WhatsApp" }).click();
    await page.waitForURL(/\/integrations\/whatsapp$/);

    // a customer who wrote to us, and a reply of ours that waits for the OK (it mentions a price)
    psql("update public.platform_flags set enabled = true where key = 'outbox_enabled' and enabled = false");
    const company = c.uuid(), contact = c.uuid(), lead = c.uuid();
    const T = `/v1/tenants/${c.tenant}`;
    for (const [route, body] of [
      ["companies", { id: company, name: `E2E Chat Silks ${stamp}`, type: "customer", country: "IN", city: "Demoville", tags: ["e2e", "synthetic"] }],
      ["contacts", { id: contact, company_id: company, full_name: `E2E Chat Person ${stamp}`, phone: "+00 90002 00077" }],
      ["leads", { id: lead, company_id: company, contact_id: contact, source: "E2E (synthetic)" }],
    ]) {
      const r = await api("POST", `${T}/${route}`, body, token);
      must(r.status === 200 || r.status === 201, `${route}: HTTP ${r.status}`);
    }
    must((await api("POST", `${T}/contacts/${contact}/record-consent`, { channel: "whatsapp", status: "granted", basis: "explicit_consent", evidence_type: "web_form", evidence_ref: `e2e:chat:${stamp}` }, token)).status === 200, "consent not recorded");
    const inbound = await api("POST", `${T}/leads/${lead}/enquiries`, { id: c.uuid(), channel: "whatsapp", received_at: new Date(Date.now() - 600_000).toISOString(), subject: null, text: "Hello, do you have red silk sarees?" }, token);
    must([200, 201, 409].includes(inbound.status), `inbound: HTTP ${inbound.status}`);
    const price = await api("POST", `${T}/outbox/messages`, { message_id: c.uuid(), lead_id: lead, text: "Yes, this saree costs only 500 rupees. There is a discount this week.", language: "en", category: "reply_to_inbound", source: "owner" }, token);
    must(price.status === 200 && price.body.message.status === "needs_approval", `the price message should wait: ${price.status} ${price.body?.message?.status}`);

    await page.goto(`${base()}/chats`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "Customer chats" }).waitFor();
    const row = page.getByRole("link").filter({ hasText: `E2E Chat Person ${stamp}` });
    must((await row.count()) === 1, "the customer is not in the list");
    must(!(await text(page)).includes("90002 00077"), "the customer's number is on the list");
    await page.screenshot({ path: path.join(SHOTS, "CC5-chats-list.png"), fullPage: true });
    await row.click();
    await page.waitForURL(new RegExp(`/chats/${lead}$`));
    await page.getByRole("heading", { level: 1, name: `E2E Chat Person ${stamp}` }).waitFor();
    const body = await text(page);
    must(body.includes("Hello, do you have red silk sarees?") && body.includes("costs only 500 rupees"), "the thread does not show both messages");
    must(body.includes("Waiting for OK") && body.includes("Mentions a price"), "the waiting message and its reason are not shown");
    must(/wait until the morning/.test(body), "the quiet-hours note is missing");
    must(!body.includes("90002 00077"), "the customer's number is on the chat");
    await page.screenshot({ path: path.join(SHOTS, "CC5-chat-thread.png"), fullPage: true });
    const audit = await phoneAudit(c, "CC5-chat");

    // approve = send (or hold for the morning): the state changes through the real outbox
    await page.getByRole("button", { name: "Approve and send" }).click();
    await page.locator('[data-chat="thread"]').getByRole("status").first().waitFor();
    const after = await api("GET", `${T}/outbox/messages/${price.body.message.id}`, null, token);
    must(["queued", "sent"].includes(after.body.status), `after approval the message is ${after.body.status}`);
    must(!(await page.getByRole("button", { name: "Approve and send" }).count()), "the approve button is still there");
    // a reply of ours: a new message, the rules decide
    await page.getByLabel("Your message").fill("Thank you, we are open until 8 pm today.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await page.locator('[data-chat="thread"]').getByRole("status").filter({ hasText: /Sent|Held|Queued|Waiting|Not sent/ }).first().waitFor();
    const log = await api("GET", `${T}/outbox/messages?limit=20`, null, token);
    must(log.body.items.some((m) => m.text.includes("we are open until 8 pm") && m.lead_id === lead), "the reply is not in the outbox");
    must(audit.length === 0, `phone: ${audit.join(" | ")}`);
    return "Connect: not connected, connecting, connected, needs attention, connected again (real API); chat list and thread with the reason in words and no number; approve moved the real message; a reply reached the real outbox; phone and dark clean";
  }, page);
}
