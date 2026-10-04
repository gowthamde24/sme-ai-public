// Privacy walkthrough (T006b M1): the Owner's erasure page. Owner asks for one contact to be erased, the Admin sees it and cannot run it,
// the Owner previews, is stopped without the confirmation, erases, and the contact reads erased; a workspace-wide request is refused
// inside its 24 hours and cancelled; Sales and Viewer see no link and a refusal. Needs `make seed-demo` and `npm run setup-users`.
// WRITES to the local demo workspace (it erases one synthetic contact).
import { launch, login, shot, record, text, discover, BASE } from "./lib.mjs";

const { browser, context } = await launch();
const page = await context.newPage();
try {
  await login(page, "owner");
  const { tenant: T } = await discover(page);

  await page.goto(`${BASE}/app/tenants/${T}`);
  record("P1 workspace page links to Privacy", (await text(page)).includes("Privacy →") ? "PASS" : "FAIL", "the 'Privacy →' link for the owner", await shot(page, "P1-workspace-owner"));

  await page.goto(`${BASE}/app/tenants/${T}/privacy`);
  let s = await shot(page, "P2-privacy-page-owner");
  const b2 = await text(page);
  const explains = /cannot be undone/.test(b2) && /backups/.test(b2) && /whole workspace keeps company names/.test(b2);
  record("P2 page explains what erasure does and cannot do", explains ? "PASS" : "FAIL", `irreversible, backups and exports, company identity in the workspace scope: ${explains}`, s);

  // ask for one contact
  const contactName = (await page.locator("#erase-contact option").first().innerText()).trim();
  await page.click('button:has-text("Request erasure")');
  await page.waitForSelector('form [role="status"], form [role="alert"]', { timeout: 15000 });
  const askMsg = (await page.locator('form [role="status"], form [role="alert"]').first().innerText()).trim();
  await page.reload();
  s = await shot(page, "P3-requested");
  const row = page.locator("table tbody tr", { hasText: "One contact" }).first();
  record("P3 asking erases nothing", /Nothing is erased until the owner runs it/.test(askMsg) && /Waiting for the owner/.test(await row.innerText()) ? "PASS" : "FAIL", `message: "${askMsg}"; row: "${(await row.innerText()).replace(/\s+/g, " ")}"`, s);

  // the Admin sees it and cannot run it
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(admin, "admin");
  await admin.goto(`${BASE}/app/tenants/${T}/privacy`);
  const adminRow = admin.locator("table tbody tr", { hasText: "One contact" }).first();
  const adminHas = { erase: await adminRow.locator('button:has-text("Erase now")').count(), cancel: await adminRow.locator('button:has-text("Cancel request")').count() };
  record("P4 an admin can see and cancel but not run", adminHas.erase === 0 && adminHas.cancel === 1 && /Only the owner can run this/.test(await adminRow.innerText()) ? "PASS" : "FAIL", `Erase now: ${adminHas.erase}, Cancel request: ${adminHas.cancel}`, await shot(admin, "P4-privacy-admin"));

  // the Owner previews
  const pending = page.locator("table tbody tr", { hasText: "Waiting for the owner" }).first();
  await pending.locator('button:has-text("Preview")').click();
  await pending.locator('[role="status"]').waitFor({ timeout: 15000 });
  s = await shot(page, "P5-preview");
  const prev = (await pending.locator('[role="status"]').innerText()).replace(/\s+/g, " ");
  record("P5 preview shows counts and changes nothing", /Preview only/.test(prev) && /Would change/.test(prev) && /Waiting for the owner/.test(await pending.innerText()) ? "PASS" : "FAIL", prev.slice(0, 200), s);

  // erasing needs the typed words
  const ownerRow = () => page.locator("table tbody tr", { hasText: "Waiting for the owner" }).first();
  const phrase = (await ownerRow().locator("form strong").first().innerText()).trim();
  const eraseBtn = ownerRow().locator('button:has-text("Erase now")');
  await ownerRow().locator('input[name="confirm_text"]').fill("ERASE");
  const wrongDisabled = await eraseBtn.isDisabled();
  record("P6 erasing needs the typed words", wrongDisabled && phrase === `ERASE ${contactName}` ? "PASS" : "FAIL", `the button is disabled for a wrong phrase: ${wrongDisabled}; the words shown: "${phrase}" (ERASE plus the contact's name)`, await shot(page, "P6-needs-typed-words"));

  // erase for real
  await ownerRow().locator('input[name="confirm_text"]').fill(phrase);
  await eraseBtn.click();
  await page.waitForFunction(() => !/Waiting for the owner/.test(document.body.innerText), null, { timeout: 20000 });
  await page.reload();
  s = await shot(page, "P7-completed");
  const done = (await page.locator("table tbody tr", { hasText: "Completed" }).first().innerText()).replace(/\s+/g, " ");
  record("P7 completed: counts, names note, no value", /Completed/.test(done) && /Changed/.test(done) && /Names are matched only when a whole field equals the name/.test(done) && !done.includes(contactName) ? "PASS" : "FAIL", done.slice(0, 260), s);

  // the contact is gone from the list (an erased contact is archived) and its name is nowhere on the page
  await page.goto(`${BASE}/app/tenants/${T}?tab=contacts`);
  s = await shot(page, "P8-contacts-after");
  const contactsText = await text(page);
  record("P8 the erased contact is no longer listed", !contactsText.includes(contactName) ? "PASS" : "FAIL", `its name appears on the contacts tab: ${contactsText.includes(contactName)}`, s);

  // the whole workspace waits 24 hours
  await page.goto(`${BASE}/app/tenants/${T}/privacy`);
  await page.check('input[name="scope"][value="tenant"]');
  await page.click('button:has-text("Request erasure")');
  await page.waitForSelector('form [role="status"], form [role="alert"]', { timeout: 15000 });
  await page.reload();
  const wide = page.locator("table tbody tr", { hasText: "The whole workspace" }).filter({ hasText: "Waiting for the owner" }).first();
  const widePhrase = (await wide.locator("form strong").first().innerText()).trim();
  await wide.locator('input[name="confirm_text"]').fill(widePhrase);
  await wide.locator('button:has-text("Erase now")').click();
  await page.waitForSelector('table [role="alert"]', { timeout: 15000 });
  const windowMsg = (await page.locator('table [role="alert"]').first().innerText()).trim();
  record("P9 a workspace erasure is refused inside 24 hours", /24 hours/.test(windowMsg) && /^ERASE [a-z0-9-]+$/.test(widePhrase) ? "PASS" : "FAIL", `words: "${widePhrase}" (ERASE plus the workspace slug); message: "${windowMsg}"`, await shot(page, "P9-window"));
  await wide.locator('button:has-text("Cancel request")').click();
  await page.waitForFunction(() => /Cancelled/.test(document.body.innerText), null, { timeout: 15000 });
  await page.reload();
  record("P10 it can be cancelled", (await page.locator("table tbody tr", { hasText: "The whole workspace" }).filter({ hasText: "Cancelled" }).count()) > 0 && (await page.locator("table tbody tr", { hasText: "The whole workspace" }).filter({ hasText: "Waiting for the owner" }).count()) === 0 ? "PASS" : "FAIL", "the row reads Cancelled and none is waiting", await shot(page, "P10-cancelled"));

  // Sales and Viewer
  for (const role of ["sales", "viewer"]) {
    const other = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await login(other, role);
    await other.goto(`${BASE}/app/tenants/${T}`);
    const hasLink = (await text(other)).includes("Privacy →");
    await other.goto(`${BASE}/app/tenants/${T}/privacy`);
    const b = await text(other);
    record(`P11 ${role} sees no link and a refusal`, !hasLink && /Only an owner or admin can ask/.test(b) && !(await other.locator('button:has-text("Request erasure")').count()) ? "PASS" : "FAIL", `link: ${hasLink}; refusal shown: ${/Only an owner or admin can ask/.test(b)}`, await shot(other, `P11-privacy-${role}`));
  }
} catch (error) {
  record("ERROR", "FAIL", String(error).slice(0, 300));
} finally {
  await browser.close();
}
const bad = (await import("./lib.mjs")).results.filter((r) => r.status !== "PASS");
console.log(`\n${bad.length === 0 ? "ALL PASS" : bad.length + " step(s) not PASS: " + bad.map((r) => r.id).join(", ")}`);
process.exit(bad.some((r) => r.status === "FAIL") ? 1 : 0);
