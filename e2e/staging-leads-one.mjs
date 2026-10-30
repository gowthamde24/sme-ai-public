// ONE list of leads (owner 30 Oct), on staging, as a synthetic demo owner. Staging only.
//   node e2e/staging-leads-one.mjs [textiles|construction_materials|education] [desktop|phone] [en|te]
// The Customers section has the tabs Leads, Buyers, Add leads (a pack's own finder tabs may follow) and NO second "Leads" (ICP / Blind scoring / Export JSON); the Leads page shows "New" at most once per row and never an
// internal id as a name; Settings > Data has "Lead scoring (advanced)" that opens the old screen. Pictures in ~/Desktop/v2-overnight/shots-df/.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
const lang = process.argv[4] || "en";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, size);
const p = s.page;
const tag = `lo-${pack}-${size}-${lang}`;
const PHONE = /^\+?[\d\s-]{7,16}$/; // a phone number is the allowed fallback name (its digits look like hex)
const ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b|(?:enquiry|whatsapp customer|lead|contact)\s+#?(?=[0-9a-f]*\d)[0-9a-f]{6,}/i;
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  await p.goto(`${s.base}/lead-desk`, { waitUntil: "domcontentloaded" });
  await p.locator("main h1").first().waitFor({ timeout: 45000 });
  await sleep(2000);
  const tabs = (await p.locator('[data-frame="group-tabs"] a').allTextContents()).map((x) => x.trim());
  console.log(`tabs: ${tabs.join(" | ")}`);
  if (lang === "en") {
    ok("the tabs start Leads, Customers, Add leads", tabs[0] === "Leads" && /^Customers/.test(tabs[1]) && tabs[2] === "Add leads", tabs.join("|"));
    ok("no second Leads tab and no Lead Desk", tabs.filter((x) => x === "Leads").length === 1 && !tabs.includes("Lead Desk"));
    ok("the page title is Leads", (await p.locator("main h1").first().innerText()).trim() === "Leads");
  } else ok("three or more tabs", tabs.length >= 3, tabs.join("|"));
  const body = await p.locator("main").innerText();
  ok("no ICP / Blind scoring / Export JSON on the Leads page", !/blind|ICP|Export JSON/i.test(body));
  await shot(s, `${tag}-1-leads`, { fullPage: false });
  const rows = p.locator('[data-part="leads"] > li');
  const n = await rows.count();
  console.log(`rows: ${n}`);
  let dupNew = 0;
  let idName = 0;
  const newWord = lang === "en" ? /^New$/ : null;
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const title = (await row.locator("a").first().innerText()).trim();
    if (!PHONE.test(title) && ID.test(title)) {
      idName++;
      console.log(`  id-like name: ${title}`);
    }
    if (i < 12) console.log(`  row ${i}: ${title}`);
    if (newWord) {
      const pills = (await row.locator("span").allTextContents()).map((x) => x.trim()).filter((x) => newWord.test(x));
      if (pills.length > 1) dupNew++;
    }
  }
  ok("no row shows 'New' twice", dupNew === 0, `rows with two: ${dupNew}`);
  ok("no row is named with an internal id", idName === 0, `rows named by an id: ${idName}`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok("no sideways scroll of the page", !overflow);
  if (n > 0) {
    await rows.first().locator("a").first().click();
    await p.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 30000 });
    await p.locator("main h1").first().waitFor({ timeout: 30000 });
    await sleep(1500);
    const h1 = (await p.locator("main h1").first().innerText()).trim();
    ok("the lead page title is not an id", !ID.test(h1), h1);
    const back = p.locator('main a[href$="/lead-desk"]').first();
    console.log(`  detail title: ${h1}`);
    ok("the way back goes to Leads", (await back.count()) > 0);
    await shot(s, `${tag}-2-detail`, { fullPage: false });
  }
  await p.goto(`${s.base}/settings?section=data`, { waitUntil: "domcontentloaded" });
  const link = p.locator('main a[href$="/review"]').first();
  await link.waitFor({ timeout: 45000 });
  ok("Settings > Data has the Lead scoring (advanced) link", true);
  await shot(s, `${tag}-3-settings`, { fullPage: false });
  await link.click();
  await p.waitForURL(/\/review/, { timeout: 30000 });
  await p.locator("main h1").first().waitFor({ timeout: 30000 });
  ok("it opens the old scoring screen", /\/review/.test(p.url()));
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
