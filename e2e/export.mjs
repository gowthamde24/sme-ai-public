// Export checks: Admin downloads the CSV (content checks); Sales and Viewer are refused.
import fs from "node:fs";
import path from "node:path";
import { launch, login, shot, record, discover, BASE, SHOTS } from "./lib.mjs";

const { browser, context } = await launch();
const page = await context.newPage();
try {
  await login(page, "admin");
  const { tenant: T } = await discover(page);
  await page.goto(`${BASE}/app/tenants/${T}/review`);
  await page.waitForSelector("article.review-card");
  const s = await shot(page, "B7-review-admin");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.locator('a:has-text("Export CSV")').click()]);
  const file = path.join(SHOTS, "export-admin.csv");
  await dl.saveAs(file);
  const raw = fs.readFileSync(file, "utf8");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < raw.length; i++) { const c = raw[i];
    if (q) { if (c === '"') { if (raw[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows[0], data = rows.slice(1).filter((r) => r.length > 1);
  const labelIdx = head.indexOf("label"), reasonIdx = head.indexOf("reason_code");
  const bad = data.filter((r) => r[labelIdx] === "bad");
  const formula = data.flatMap((r) => r.filter((c) => /^[=+\-@\t\r]/.test(c)));
  record("B7 Admin exports the CSV", data.length >= 20 && bad.every((r) => r[reasonIdx]) && formula.length === 0 ? "PASS" : "FAIL", `${data.length} rows (at least 20: every reviewer's labels), ${bad.length} Bad rows all with a reason, formula cells=${formula.length}`, file);
  const note = await page.locator("text=Every export").count();
  record("B7b export button says what it contains and that it is logged", note > 0 ? "PASS" : "FAIL", "the note under the buttons", s);
} catch (e) { record("B7", "FAIL", `script error: ${e.message.split("\n")[0]}`, await shot(page, "B7-error").catch(() => "")); }
await browser.close();

for (const role of ["sales", "viewer"]) {
  const { browser: b2, context: c2 } = await launch();
  const p2 = await c2.newPage();
  try {
    await login(p2, role);
    const { tenant: T } = await discover(p2);
    await p2.goto(`${BASE}/app/tenants/${T}/review`);
    await p2.waitForSelector("article.review-card");
    const links = await p2.locator('a:has-text("Export")').count();
    const resp = await p2.request.get(`${BASE}/app/tenants/${T}/review/export?format=csv`, { maxRedirects: 0 });
    record(`B8 ${role}: export refused`, links === 0 && resp.status() >= 400 ? "PASS" : "FAIL", `export links=${links}; direct request → HTTP ${resp.status()}`, await shot(p2, `B8-review-${role}`));
  } catch (e) { record(`B8 ${role}`, "FAIL", `script error: ${e.message.split("\n")[0]}`, ""); }
  await b2.close();
}
