// The owner's three TEST workspaces on staging (job test-workspaces, 4 Nov 2026): look at them in a real browser as their Owner and take the pictures the owner's reviewer asked for.
//   node e2e/staging-owner-test.mjs [--only textiles,construction_materials,education] [--size desktop|phone|both] [--mode shots|dump|settings] [--out DIR]
//   --mode settings: every Settings tab in every workspace of the account; exits 1 when My profile has no form anywhere (e.g. --who demo, --who owner-test)
// Staging only (https://staging.stack19.com), synthetic data only. It signs in as each workspace's HELPER account (owner-test-<pack>@demo.example.test, made by scripts/seed_owner_test.py), which is an Owner
// of the workspace until the hand-over, so it sees what the owner sees. Passwords and authenticator secrets come from Google Secret Manager into this process's memory only; nothing secret is printed or photographed.
// It never presses a button that sends, approves, removes or spends: it opens pages and reads them. `dump` prints each page's visible text (for checks); `shots` saves the pictures.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WEB = "https://staging.stack19.com";
const GCP_PROJECT = "project-2757c07e-37d2-4167-88f";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ONLY = arg("only", "textiles,construction_materials,education").split(",");
const SIZE = arg("size", "both");
const MODE = arg("mode", "shots");
const OUT = arg("out", "/Volumes/Stack19/stack19/v2-overnight/shots-tw");
const PAGES = (arg("pages", "") || "").split(",").filter(Boolean);
const WHO = arg("who", "owner-test"); // owner-test = the helpers of the owner's test workspaces; demo = the demo owners of the DEMO workspaces (scripts/seed_staging.py)
const LANG = arg("lang", "en"); // the app's language (the sme_lang cookie): en or te
const SEARCH = arg("search", ""); // finder mode: run ONE Lead Finder search with these words (fixture in a demo/test workspace: made-up businesses, nothing billed)
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 }, phone360: { width: 360, height: 780 } };
const SHORT = { textiles: "silks", construction_materials: "cements", education: "school" };
// the pack's own card: the page that holds the pack's own work
const OWN = { textiles: ["quotes", "/quotes"], construction_materials: ["trips", "/orders/trips"], education: ["fees", "/fees"] };

const secret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${GCP_PROJECT}`], { encoding: "utf8" }).trim();
function totp(b32, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of b32.trim().toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function signIn(page, pack) {
  const email = `${WHO}-${pack.replace(/_/g, "-")}@demo.example.test`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(`${WEB}/login`);
      await page.fill('input[name="email"]', email, { timeout: 45000 });
      await page.fill('input[name="password"]', secret(`sme-${WHO}-${pack}-password`));
      await page.click('button:has-text("Sign in")');
      await page.waitForURL(/\/(app|auth\/mfa|setup)/, { timeout: 45000 });
      if (/\/auth\/mfa/.test(page.url())) {
        const seed = secret(`sme-${WHO}-${pack}-totp`);
        for (const offset of [0, 1, -1]) {
          await page.fill('input[name="code"]', totp(seed, offset), { timeout: 45000 });
          await Promise.all([page.waitForURL(/\/app/, { timeout: 15000 }).catch(() => null), page.click('button:has-text("Verify")')]);
          if (/\/app/.test(page.url())) break;
        }
      }
      if (/\/app/.test(page.url())) return true;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return false;
}

const text = async (page) => (await page.locator("body").innerText().catch(() => "")).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
const settle = async (page) => {
  await page.waitForFunction(() => !/Loading…/.test((document.querySelector("main")?.innerText || "").slice(0, 200)), null, { timeout: 30000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(800);
};

const report = [];
const browser = await chromium.launch();
try {
  for (const pack of ONLY) {
    const sizes = SIZE === "both" ? ["desktop", "phone"] : SIZE.split(",");
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: SIZES[size] ?? SIZES.desktop, colorScheme: "light", locale: "en-IN", timezoneId: "Asia/Kolkata", reducedMotion: "reduce", isMobile: size !== "desktop", hasTouch: size !== "desktop", deviceScaleFactor: size === "desktop" ? 1 : 2 });
      await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB }, { name: "sme_lang", value: LANG, url: WEB }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      if (!(await signIn(page, pack))) throw new Error(`sign-in of ${pack} failed`);
      await page.goto(`${WEB}/app`, { waitUntil: "domcontentloaded" });
      const href = await page.locator('a[href^="/app/tenants/"]').first().getAttribute("href").catch(() => null);
      const tenant = /\/app\/tenants\/([0-9a-f-]{36})/.exec(href || page.url())?.[1];
      if (!tenant && MODE === "settings") {
        // a helper that was taken out of its workspace at the hand-over: nothing to open (said, not a failure)
        report.push({ pack, size, page: "settings", path: "/", status: 0, url: new URL(page.url()).pathname, flags: [], errors: [], note: `${WHO}-${pack}: in no workspace (skipped)` });
        console.log(`settings ${WHO}-${pack}: in no workspace (skipped)`);
        await context.close();
        continue;
      }
      if (!tenant) throw new Error(`no workspace for ${pack}`);
      const base = `${WEB}/app/tenants/${tenant}`;
      const list = ["switcher", "verify", "more", "finder", "chatcard", "settings"].includes(MODE) ? [] : PAGES.length ? PAGES.map((p) => [p.replace(/\W+/g, "-") || "today", p === "today" ? "" : p]) : size === "desktop" ? [["today", ""], ["customers", "/lead-desk"], OWN[pack], ["office", "/office"]] : [["today", ""], ["customers", "/lead-desk"], OWN[pack]];
      for (const [name, p] of list) {
        const res = await page.goto(`${base}${p}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        const body = await text(page);
        const file = `${SHORT[pack]}-${name}-${size === "desktop" ? "1440-light" : size === "phone" ? "390" : "360"}.png`;
        if (MODE === "shots") await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        const flags = [];
        if (/Lead Finder/i.test(body)) flags.push("shows 'Lead Finder'");
        if (/Demo lead \d|Test Buyer|\(synthetic\)/i.test(body)) flags.push("fake-looking name");
        if (/machine[- ]translat|translated automatically/i.test(body)) flags.push("machine-translation notice");
        if (/[a-z]+\.[a-z_]+\.[a-z_]+/.test(body.replace(/https?:\S+|\S+@\S+|\S+\.(com|in|test)\b/g, ""))) flags.push("maybe a raw string key");
        if (pack === "education" && /outreach|campaign|find retailers|lead desk/i.test(body)) flags.push("education shows outreach words");
        report.push({ pack, size, page: name, path: p || "/", status: res?.status(), url: new URL(page.url()).pathname, flags, errors: [...errors] });
        if (MODE === "dump") {
          const links = await page.$$eval("nav a[href]", (as) => as.map((a) => `${(a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")} -> ${a.getAttribute("href")}`)).catch(() => []);
          console.log(`\n===== ${pack} ${size} ${name} (${res?.status()}) ${new URL(page.url()).pathname}\n${body.slice(0, 3500)}\n--- menu links: ${[...new Set(links)].join(" | ")}`);
        }
        errors.length = 0;
      }
      if (MODE === "switcher") {
        // the workspace switcher at the top of the menu: drawn as a button only for a person in two or more workspaces
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        if (size !== "desktop") await page.getByRole("button", { name: /menu/i }).first().click().catch(() => null);
        const sw = page.locator("summary", { hasText: /Switch workspace/ }).first();
        const has = await sw.count();
        if (has) {
          await sw.click();
          await page.waitForTimeout(500);
        }
        const names = has ? await page.locator('ul[aria-label="Your workspaces"] li').allInnerTexts() : [];
        await page.screenshot({ path: path.join(OUT, `switcher-${SHORT[pack]}-${size === "desktop" ? "1440-light" : "390"}.png`), fullPage: false });
        report.push({ pack, size, page: "switcher", path: "/", status: has ? 200 : 0, url: new URL(page.url()).pathname, flags: has ? [] : ["no switcher"], errors: [], workspaces: names.map((n) => n.replace(/\s+/g, " ").trim()) });
        console.log(`switcher ${pack}/${size}: ${has ? names.map((n) => n.replace(/\s+/g, " ").trim()).join(" | ") : "none"}`);
      }
      if (MODE === "finder") {
        // the Lead Finder screens (job lead-finder part D): optionally ONE search (plan card -> OK -> result card), then the pictures of the tab, Today and Settings -> Lead Finder
        const sz = size === "desktop" ? "1440-light" : size === "phone" ? "390" : "360";
        const tag = `${SHORT[pack]}-finder-${LANG}-${sz}`;
        await page.goto(`${base}/retailers`, { waitUntil: "domcontentloaded" });
        await settle(page);
        if (SEARCH) {
          await page.locator("[data-finder] input").first().fill(SEARCH);
          await page.locator("[data-finder] button[type=submit]").first().click();
          await page.locator("[data-plan-ok]").first().waitFor({ timeout: 60000 }).catch(() => null);
          await page.screenshot({ path: path.join(OUT, `${tag}-plan.png`), fullPage: false });
          const plan = (await page.locator("[data-finder]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
          console.log(`plan ${pack}/${size}: ${plan.slice(0, 300)}`);
          await page.locator("[data-plan-ok]").first().click().catch((e) => console.log("ok: " + String(e).slice(0, 100)));
          await page.waitForFunction(() => /Found \d+/.test(document.querySelector("[data-finder]")?.textContent || ""), null, { timeout: 60000 }).catch(() => null);
          const result = (await page.locator("[data-finder]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
          console.log(`result ${pack}/${size}: ${result.slice(0, 300)}`);
          await page.screenshot({ path: path.join(OUT, `${tag}-result.png`), fullPage: false });
          await page.goto(`${base}/retailers`, { waitUntil: "domcontentloaded" });
          await settle(page);
        }
        await page.screenshot({ path: path.join(OUT, `${tag}-prospects.png`), fullPage: true });
        const body = await text(page);
        console.log(`prospects ${pack}/${size}/${LANG}: ${body.length} characters; Google Maps shown: ${/Google Maps/.test(body)}; demo label: ${/Made-up|కల్పిత/.test(body)}; machine-translation notice: ${/machine[- ]translat|translated automatically/i.test(body)}`);
        for (const [n, p] of [["today", ""], ["settings", "/settings?section=leadfinder"]]) {
          await page.goto(`${base}${p}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          await page.screenshot({ path: path.join(OUT, `${SHORT[pack]}-${n}-lf-${LANG}-${sz}.png`), fullPage: true });
        }
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        const today = await text(page);
        const rows = (today.match(/fit \d+/g) || []).length;
        console.log(`today ${pack}/${size}/${LANG}: prospect rows ${rows}; Lead Finder in team: ${/Lead Finder|లీడ్ ఫైండర్/.test(today)}`);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        console.log(`layout ${pack}/${size}: horizontal scroll ${wide}`);
      }
      if (MODE === "chatcard") {
        // Lead Finder in the chat (contract 1b) and the draft quote of a qualified call (contract 7): the search is ASKED in the chat (a fixture search where the workspace is a demo/test one), the card's
        // OK is pressed only with --ok; the draft quote's preview is opened, its "Make the draft quote" is never pressed
        const sz = size === "desktop" ? "1440" : "390";
        if (SEARCH) {
          await page.goto(base, { waitUntil: "domcontentloaded" });
          await settle(page);
          const box = page.locator('[data-chat="form"] textarea').first();
          await box.fill(SEARCH);
          await box.press("Enter");
          const card = page.locator('[data-chat="lead-finder"]').last();
          await card.waitFor({ timeout: 90000 }).catch(() => null);
          await page.waitForTimeout(1500);
          console.log(`chat card ${pack}/${size}/${LANG}: ${(await card.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 300)}`);
          await card.scrollIntoViewIfNeeded().catch(() => null);
          await page.screenshot({ path: path.join(OUT, `${SHORT[pack]}-chat-plan-${LANG}-${sz}.png`), fullPage: false });
          if (process.argv.includes("--ok")) {
            await card.locator("[data-plan-ok]").first().click().catch((e) => console.log("ok: " + String(e).slice(0, 100)));
            await card.locator("[data-result-card]").first().waitFor({ timeout: 60000 }).catch(() => null);
            console.log(`chat result ${pack}/${size}/${LANG}: ${(await card.innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 300)}`);
            await page.screenshot({ path: path.join(OUT, `${SHORT[pack]}-chat-result-${LANG}-${sz}.png`), fullPage: false });
          }
        }
        await page.goto(`${base}/retailers?status=qualified`, { waitUntil: "domcontentloaded" });
        await settle(page);
        const draft = page.locator("[data-quote-draft-box]").first();
        if (await draft.count()) {
          await draft.locator("summary").first().click().catch(() => null);
          await page.locator("[data-draft-lines], [data-draft-left-out], [data-draft-made]").first().waitFor({ timeout: 30000 }).catch(() => null);
          await page.waitForTimeout(800);
          console.log(`draft ${pack}/${size}/${LANG}: ${(await draft.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`);
          await draft.scrollIntoViewIfNeeded().catch(() => null);
          await page.screenshot({ path: path.join(OUT, `${SHORT[pack]}-draft-quote-${LANG}-${sz}.png`), fullPage: false });
        } else console.log(`draft ${pack}/${size}: no qualified prospect with a draft box`);
      }
      if (MODE === "more") {
        // the phone: what the More sheet offers (is there a way to another workspace?)
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.getByRole("button", { name: /^More/ }).last().click().catch((e) => console.log("more: " + String(e).slice(0, 100)));
        await page.waitForTimeout(800);
        const links = await page.$$eval("a[href], button", (as) => as.filter((a) => a.offsetParent !== null).map((a) => `${(a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")} -> ${a.getAttribute("href") ?? "(button)"}`));
        console.log(`more ${pack}/${size}: ${links.map((l) => l.replace(/\/app\/tenants\/[0-9a-f-]+/, "")).join(" | ")}`);
        await page.screenshot({ path: path.join(OUT, `more-${SHORT[pack]}-390.png`), fullPage: false });
      }
      if (MODE === "settings") {
        // a slow staging answer is tried once more before it counts
        const open = async (url) => {
          for (let i = 1; ; i++) {
            try {
              return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            } catch (e) {
              if (i === 2) throw e;
            }
          }
        };
        // Settings, every tab, in EVERY workspace this account is in (owner bug, 5 Nov 2026: My profile said "Not available yet"). My profile is personal: it must show the name form for
        // every member on every plan; any other tab that says "Not available yet" or "could not be loaded" is listed. Reads only: nothing is saved.
        const ids = new Set([tenant]);
        await open(`${base}/settings?section=profile`);
        for (const h of await page.$$eval('a[href^="/app/tenants/"]', (as) => as.map((a) => a.getAttribute("href") || "")).catch(() => [])) {
          const id = /^\/app\/tenants\/([0-9a-f-]{36})/.exec(h)?.[1];
          if (id) ids.add(id);
        }
        for (const id of ids) {
          const wsBase = `${WEB}/app/tenants/${id}`;
          await open(`${wsBase}/settings?section=profile`);
          await settle(page);
          const tabs = await page.$$eval('nav[aria-label="Parts of Settings"] a[href*="section="]', (as) => as.map((a) => new URL(a.href).searchParams.get("section"))).catch(() => []);
          const flagsOut = [];
          for (const section of tabs.length ? tabs : ["profile"]) {
            const res = await open(`${wsBase}/settings?section=${section}`).catch((e) => (flagsOut.push(String(e.message).split("\n")[0]), null));
            await settle(page);
            const body = await text(page);
            const flags = flagsOut.splice(0);
            if (new URL(page.url()).searchParams.get("section") !== section && section !== "business") flags.push(`opened ${new URL(page.url()).search} instead`);
            if (/Not available yet/i.test(body)) flags.push(`says "Not available yet" (${(body.match(/Not available yet/gi) || []).length}x)`);
            if (/could not be loaded/i.test(body)) flags.push("a part could not be loaded");
            if (section === "profile") {
              const name = await page.getByLabel("Your name").count();
              const lang = await page.getByText("Your language").count();
              if (!name || !lang) flags.push(`My profile has no ${!name ? "name field" : "language"} (the form is missing)`);
            }
            report.push({ pack, size, page: `settings-${section}`, path: `/settings?section=${section}`, status: res?.status(), url: `workspace ${id.slice(0, 8)}`, flags, errors: [...errors], profile: section === "profile" });
            errors.length = 0;
          }
        }
      }
      if (MODE === "verify") {
        // the steps of the owner's 10-minute script, as far as they can be checked WITHOUT using them up: two typed questions (en, te), the first Needs-you item opened (its Approve
        // button is looked at, never pressed), the Lead Desk, the pack's own page, the example-data line (Remove / Remove and load it again are looked at, never pressed)
        const v = (step, ok, note) => {
          report.push({ pack, size, page: `verify:${step}`, path: "", status: ok ? 200 : 0, url: "", flags: ok ? [] : [note], errors: [] });
          console.log(`${ok ? "PASS" : "FAIL"} ${pack}/${size} ${step} :: ${String(note).replace(/\s+/g, " ").slice(0, 300)}`);
        };
        const ask = async (q) => {
          await page.goto(base, { waitUntil: "domcontentloaded" });
          await settle(page);
          const box = page.locator('[data-chat="form"] textarea').first();
          await box.fill(q);
          await box.press("Enter");
          const answer = page.locator('[data-chat="assistant"]').last();
          await answer.waitFor({ timeout: 60000 }).catch(() => null);
          await page.waitForFunction(() => { const a = [...document.querySelectorAll('[data-chat="assistant"]')].pop(); return a && a.innerText.trim().length > 20 && !/…$/.test(a.innerText.trim()); }, null, { timeout: 90000 }).catch(() => null);
          await page.waitForTimeout(2500);
          return ((await answer.innerText().catch(() => "")) || "").trim();
        };
        const en = await ask("What needs me today?");
        v("ask-en", en.length > 20 && !/couldn't answer/i.test(en), en || "no answer");
        await page.screenshot({ path: path.join(OUT, `verify-${SHORT[pack]}-ask-en.png`), fullPage: false });
        // the owner's pill is on Auto (their profile in each test workspace); the helper has none, so its pill shows the app language: put it on Auto as the owner has it
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.locator('[data-chat="form"] [data-chat="language"] select').first().selectOption("auto").catch((e) => console.log("pill: " + String(e).slice(0, 120)));
        await page.waitForTimeout(800);
        const te = await ask("ఈ రోజు నేను ఏమి చేయాలి?");
        v("ask-te", /[ఀ-౿]/.test(te) && !/couldn't answer/i.test(te), te || "no answer");
        await page.screenshot({ path: path.join(OUT, `verify-${SHORT[pack]}-ask-te.png`), fullPage: false });
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        const rows = await page.locator('[data-part="needs"] li, section[aria-labelledby="needs-heading"] li').count().catch(() => 0);
        const review = page.getByRole("link", { name: /^Review$/ }).first();
        if (await review.count()) {
          const href = await review.getAttribute("href");
          await page.goto(`${WEB}${href}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          const body = await text(page);
          v("needs-you-open", /Approve|Send|Review/i.test(body) && !/not found|went wrong/i.test(body), `${rows} rows; opened ${href?.replace(/\/app\/tenants\/[0-9a-f-]+/, "")}; ${/Approve/.test(body) ? "an Approve button is there" : "no Approve word"}`);
          await page.screenshot({ path: path.join(OUT, `verify-${SHORT[pack]}-needs-open.png`), fullPage: false });
        } else {
          const call = page.getByRole("button", { name: /^Approve( call)?$/ }).first();
          v("needs-you-open", (await call.count()) > 0, `${rows} rows; a call request with Approve and Store visit on the row itself`);
        }
        for (const [step, p, want] of [["lead-desk", "/lead-desk", /lead|enquir/i], ["pack-page", OWN[pack][1], /.{200}/s]]) {
          const res = await page.goto(`${base}${p}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          const body = await text(page);
          v(step, res?.status() === 200 && want.test(body) && !/not found|went wrong/i.test(body), `${p} ${res?.status()} ${body.length} characters`);
        }
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.locator('[data-example="loaded"] summary').first().click().catch(() => null);
        const resetBtn = await page.getByRole("button", { name: "Remove and load it again" }).count();
        const removeBtn = await page.getByRole("button", { name: "Yes, remove the example data" }).count();
        v("example-reset", resetBtn > 0 && removeBtn > 0, `Remove: ${removeBtn}, Remove and load it again: ${resetBtn} (looked at, not pressed)`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(OUT, `report-${MODE}.json`), JSON.stringify(report, null, 1));
for (const r of report) console.log(`${r.flags.length || r.errors.length ? "CHECK" : "ok   "} ${r.pack}/${r.size}/${r.page} ${r.status} ${r.url} ${[...r.flags, ...r.errors].join(" | ")}`);
// settings mode is a test: it fails when My profile is missing anywhere (the other tabs are listed, not failed)
if (MODE === "settings") {
  const broken = report.filter((r) => r.profile && r.flags.length);
  const seen = report.filter((r) => r.profile).length;
  console.log(`\nsettings: My profile opened in ${seen} workspace(s); ${broken.length ? `MISSING in ${broken.length}: ${broken.map((r) => r.url).join(", ")}` : seen ? "the form is there in every one" : "no workspace to open (this run proves nothing)"}`);
  if (broken.length || seen === 0) process.exitCode = 1;
}
