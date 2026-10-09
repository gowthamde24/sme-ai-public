// Agents click-through: agents page, start a selftest run, suggestions on the company page, promote as Owner, change-decision
// control, the lead page, and what Sales / Viewer see. Needs the API started with AGENTS_ENABLED=true and `make seed-demo`.
import { launch, login, shot, record, text, discover, BASE } from "./lib.mjs";

const { browser, context } = await launch();
const page = await context.newPage();
try {
  await login(page, "owner");
  const { tenant: T, company: COMPANY, lead: LEAD } = await discover(page);

  await page.goto(`${BASE}/app/tenants/${T}`);
  let s = await shot(page, "A1-workspace-owner");
  record("A1 the menu links to Agents", (await page.locator('nav[aria-label="Workspace menu"] a[href$="/agents"]').count()) > 0 ? "PASS" : "FAIL", "the 'Agents' item of the workspace menu", s);

  await page.goto(`${BASE}/app/tenants/${T}/agents`);
  s = await shot(page, "A2-agents-page-owner");
  const b2 = await text(page);
  const rowsBefore = await page.locator("table tbody tr").count();
  record("A2 agents page", b2.includes("Agents are on") && b2.includes("Turn agents off") ? "PASS" : "FAIL", `${rowsBefore} runs listed; times are <time> elements: ${(await page.locator("table time").count()) > 0}`, s);

  await page.selectOption("#agent-company", { index: 0 });
  await page.click('button:has-text("Start selftest run")');
  await page.waitForSelector('form [role="status"], form [role="alert"]', { timeout: 15000 });
  const msg = (await page.locator('form [role="status"], form [role="alert"]').first().innerText()).trim();
  let rowsAfter = rowsBefore, newest = "";
  for (let i = 0; i < 30; i++) {
    await page.reload();
    rowsAfter = await page.locator("table tbody tr").count();
    newest = (await page.locator("table tbody tr").first().innerText()).replace(/\s+/g, " ");
    if (rowsAfter > rowsBefore && /Completed/.test(newest)) break;
    await page.waitForTimeout(700);
  }
  s = await shot(page, "A3-start-selftest-completed");
  record("A3 start a selftest run", rowsAfter > rowsBefore && /Completed/.test(newest) ? "PASS" : "FAIL", `message: "${msg}"; runs ${rowsBefore}→${rowsAfter}; newest: "${newest}"`, s);
  const bad = /Cancelled \(cancelled\)/.test(await text(page));
  record("A3b run list wording", bad ? "CONFUSING" : "PASS", bad ? "shows 'Cancelled (cancelled)'" : "cancelled runs read 'Cancelled'", s);

  await page.goto(`${BASE}/app/tenants/${T}/companies/${COMPANY}`);
  s = await shot(page, "A4-company-suggestions-owner");
  const b4 = await text(page);
  record("A4 suggestions on the company page", (b4.match(/agent suggestion, unreviewed/g) || []).length >= 1 && /Agent note \(run [0-9a-f]{8}\)/.test(b4) ? "PASS" : "FAIL", `unreviewed suggestions: ${(b4.match(/agent suggestion, unreviewed/g) || []).length}; note reference reads 'Agent note (run …)': ${/Agent note \(run [0-9a-f]{8}\)/.test(b4)}`, s);

  const items = page.locator("section[aria-labelledby=suggestions-heading] li");
  let target = null;
  for (let i = 0; i < (await items.count()); i++) {
    const t = await items.nth(i).innerText();
    if (/unreviewed/.test(t) && /observation one/i.test(t)) { target = items.nth(i); break; }
  }
  if (!target) record("A5 promote as Owner", "FAIL", "no unreviewed 'observation one' suggestion (start another run)", s);
  else {
    const sel = target.locator("select").first();
    const preselected = await sel.inputValue();
    await sel.selectOption("medium");
    await target.locator('button:has-text("Accept")').click();
    await page.locator("section[aria-labelledby=suggestions-heading]").getByText(/Approved by a person · Medium confidence/).first().waitFor({ timeout: 15000 });
    await page.reload();
    s = await shot(page, "A5-after-accept-owner");
    const b5 = await text(page);
    const done = page.locator("section[aria-labelledby=suggestions-heading] li", { hasText: /observation one/i }).first();
    const hidden = !(await done.locator('button:has-text("Accept")').first().isVisible());
    record("A5 promote as Owner", /Approved by a person · Medium confidence/.test(b5) && preselected === "" ? "PASS" : "FAIL", `nothing preselected=${preselected === ""}; shows 'Approved by a person · Medium confidence'`, s);
    record("A5b 'Change decision' hides Accept/Reject after a decision", hidden && (await done.locator("summary", { hasText: "Change decision" }).count()) === 1 ? "PASS" : "FAIL", `Accept hidden behind 'Change decision': ${hidden}`, s);
  }

  await page.goto(`${BASE}/app/tenants/${T}/leads/${LEAD}`);
  s = await shot(page, "A6-lead-page-owner");
  record("A6 lead page", (await text(page)).includes("Agent suggestions") ? "CONFUSING" : "FAIL", "the demo run targets the COMPANY, so the lead page shows no suggestions and no score moves (lead targets come with T007)", s);

  for (const role of ["sales", "viewer"]) {
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    await login(p2, role);
    await p2.goto(`${BASE}/app/tenants/${T}/companies/${COMPANY}`);
    const sc = await shot(p2, `A7-company-${role}`);
    const accept = await p2.locator('button:has-text("Accept")').count();
    const reject = await p2.locator('button:has-text("Reject")').count();
    record(`A7 ${role}: suggestions but no review buttons`, accept === 0 && reject === 0 ? "PASS" : "FAIL", `Accept buttons=${accept}, Reject buttons=${reject}`, sc);
    await ctx2.close();
  }
} catch (e) {
  record("A-run", "FAIL", `script error: ${e.message.split("\n")[0]}`, await shot(page, "A-error").catch(() => ""));
} finally {
  await browser.close();
}
