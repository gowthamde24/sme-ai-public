// The T005 20-lead walkthrough: `node review.mjs desktop labeler1` or `node review.mjs phone labeler2` (390x844).
// Each reviewer's labels are their own, so use a reviewer who has not labelled yet (setup-local-users.mjs creates labeler1/2).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { launch, login, shot, record, text, discover, layoutReport, BASE, SHOTS, emailOf } from "./lib.mjs";

const MODE = process.argv[2] || "desktop";
const ROLE = process.argv[3] || "labeler1";
const P = MODE === "phone" ? "C" : "B";
const phone = MODE === "phone";
const { browser, context } = await launch(phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, phone ? { hasTouch: true, isMobile: true } : {});
const page = await context.newPage();
const psql = (sql) => execFileSync("docker", ["exec", "-i", `supabase_db_${process.env.E2E_SUPABASE_PROJECT || "sme-ai"}`, "psql", "-U", "postgres", "-d", "postgres", "-Atc", sql], { encoding: "utf8" }).trim();
let s;
try {
  await login(page, ROLE);
  const { tenant: T } = await discover(page);
  const reviewUrl = `${BASE}/app/tenants/${T}/review`;
  await page.goto(reviewUrl);
  await page.waitForSelector("article.review-card");

  // 1. default view
  s = await shot(page, `${P}1-queue-default-${ROLE}`);
  const t1 = await text(page);
  const cards = await page.locator("article.review-card").count();
  const hidden = (t1.match(/Score Hidden \(Blind\)/gi) || []).length;
  const bandLinks = await page.locator('a:has-text("Priority"), a:has-text("Worth Reviewing"), a:has-text("Low Priority")').count();
  record(`${P}1 scores hidden by default, no band filters`, hidden === cards && !/Score: \d+\/100/i.test(t1) && bandLinks === 0 ? "PASS" : "FAIL", `${cards} cards, ${hidden} hidden scores, band links=${bandLinks}`, s);
  const collapsed = await page.locator("details.card-compact:not([open])").count();
  const leaked = /@demo-lead|\+00 000/.test(t1);
  record(`${P}1b contact details collapsed by default`, collapsed > 0 && !leaked ? "PASS" : "FAIL", `${collapsed} collapsed 'Contact details'; e-mail/phone visible on load=${leaked}`, s);
  if (phone) {
    const lr = await layoutReport(page);
    fs.writeFileSync(`${SHOTS}/${P}1-layout.json`, JSON.stringify(lr, null, 1));
    record(`${P}1c phone layout`, lr.hscroll || lr.overflowEls.length ? "FAIL" : "PASS", `horizontal scroll=${lr.hscroll}; overflowing elements=${lr.overflowEls.length}`, s);
    record(`${P}1d touch targets >= 44px`, lr.small.length === 0 ? "PASS" : "FAIL", `${lr.small.length} under 44px, ${lr.tiny.length} under 24px${lr.small.length ? "; e.g. " + lr.small.slice(0, 6).join("; ") : ""}`, s);
  }

  // 2. next unreviewed
  const next = page.locator('a:has-text("Next unreviewed")');
  const nextOk = (await next.count()) === 1;
  if (nextOk) { await next.click(); }
  record(`${P}2 'Next unreviewed' jumps to a card`, nextOk && /#lead-/.test(page.url()) ? "PASS" : "FAIL", `url ${page.url().split("/").pop()}`, s);

  // 3. label 20 (the last by a double click)
  const all = await page.locator("article.review-card h3").allInnerTexts();
  const names = all.filter((n) => !/Meridian/.test(n)).slice(0, 20);
  const reasons = ["payment_risk", "not_our_market", "too_small", "duplicate"];
  const plan = names.map((n, i) => (i < 4 ? { n, kind: "bad", reason: reasons[i] } : { n, kind: i < 8 ? "maybe" : "good" }));
  const last = plan.pop();
  const cardOf = (n) => page.locator("article.review-card", { has: page.locator(`h3:text-is("${n}")`) });
  for (const p of plan) {
    const card = cardOf(p.n);
    if (p.kind === "bad") {
      await card.locator('button:has-text("Bad...")').click();
      await card.locator("select").selectOption(p.reason);
      await card.locator('button:has-text("Confirm Bad")').click();
    } else await card.locator(`button:text-is("${p.kind === "good" ? "Good" : "Maybe"}")`).click();
    await card.locator(`.badge-${p.kind}`).waitFor({ timeout: 15000 });
  }
  await cardOf(last.n).locator('button:text-is("Good")').dblclick();
  await cardOf(last.n).locator(".badge-good").waitFor({ timeout: 15000 });
  s = await shot(page, `${P}3-after-labelling-${ROLE}`);

  await page.reload();
  await page.waitForSelector("article.review-card");
  const badges = await page.locator("article.review-card .badge").allInnerTexts();
  const persisted = badges.filter((b) => /^(GOOD|MAYBE|BAD)/.test(b.trim())).length;
  record(`${P}3 label 20 leads and keep them after reload`, persisted >= 20 ? "PASS" : "FAIL", `${persisted} labelled after reload; Bad: ${badges.filter((b) => /^BAD/.test(b.trim())).join(", ")}`, s);
  const leadId = (await cardOf(last.n).locator('a:has-text("View evidence")').getAttribute("href")).split("/").pop();
  const rows = psql(`select count(*) from public.lead_labels l join auth.users u on u.id=l.created_by where l.lead_id='${leadId}' and u.email='${emailOf(ROLE)}'`);
  record(`${P}4 a double click makes one label`, rows === "1" ? "PASS" : "FAIL", `label rows for that lead and reviewer: ${rows}`, s);

  // 5. unreviewed only
  await page.goto(`${reviewUrl}?blind=true&unreviewed=true`);
  await page.waitForSelector("article.review-card, .hint");
  const labelledShown = await page.locator("article.review-card .badge-good, article.review-card .badge-maybe, article.review-card .badge-bad").count();
  s = await shot(page, `${P}5-unreviewed-only-${ROLE}`);
  record(`${P}5 'Unreviewed only' hides what I have labelled`, labelledShown === 0 ? "PASS" : "FAIL", `labelled cards in the filtered view: ${labelledShown}; cards shown: ${await page.locator("article.review-card").count()} (the original demo lead is the only one left)`, s);

  // 6. blindness off: scores, bands, breakdown
  await page.goto(reviewUrl);
  await page.waitForSelector("article.review-card");
  await page.locator('a:has-text("Blind Scoring: ON")').click();
  await page.waitForURL(/blind=false/);
  await page.waitForSelector("article.review-card");
  const t6 = await text(page);
  const nums = (t6.match(/Score: \d+\/100/gi) || []).length;
  const bands = await page.locator('a:has-text("Priority"), a:has-text("Worth Reviewing"), a:has-text("Low Priority"), a:has-text("Maybe (")').count();
  const breakdowns = await page.locator("details.factor-breakdown").count();
  await page.locator("details.factor-breakdown summary").first().click();
  const t6b = await text(page);
  s = await shot(page, `${P}6-blind-off-${ROLE}`);
  record(`${P}6 blindness off: scores and band filters`, nums > 0 && bands >= 4 ? "PASS" : "FAIL", `${nums} scores, ${bands} band links`, s);
  record(`${P}6b factor breakdown with plain-language 'not known yet'`, breakdowns >= nums && /not known yet/.test(t6b) && !/\(unknown\)/.test(t6b) ? "PASS" : "FAIL", `${breakdowns} breakdowns for ${nums} scored leads; 'not known yet' shown; the word 'unknown' absent`, s);
  if (phone) {
    const lr = await layoutReport(page);
    record(`${P}6c phone layout, blind off, breakdown open`, lr.hscroll || lr.overflowEls.length ? "FAIL" : "PASS", `horizontal scroll=${lr.hscroll}; overflowing=${lr.overflowEls.length}; targets under 44px=${lr.small.length}${lr.small.length ? " e.g. " + lr.small.slice(0, 4).join("; ") : ""}`, s);
  }
} catch (e) {
  record(`${P}-run`, "FAIL", `script error: ${e.message.split("\n")[0]}`, await shot(page, `${P}-error-${ROLE}`).catch(() => ""));
} finally {
  await browser.close();
}
