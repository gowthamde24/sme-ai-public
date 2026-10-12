// Job CC (the screens for the new APIs) in the real-stack run: the real web (3002), the real API (8002), the local Supabase stack, a real browser. Steps CC1 and on; each one is a screen of the job.
// The API's providers are the ones of the local stack: WhatsApp is the FAKE channel, web search and the places search are the API's own fakes, nothing leaves this machine. Run only these with E2E_ONLY=CC (see be-stack.mjs).
import path from "node:path";

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

export async function ccSteps(c) {
  const { step, page, must, text, BASE, SHOTS, SLOW, psql } = c;
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
}
