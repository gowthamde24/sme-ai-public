// Night 4 (jobs DR/DS) browser check of the new screens, in a real Chromium, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). The new screens run in their "mock" mode
// (LEADS_SCREENS, OUTREACH_SCREENS, TASK_SCREENS, TOPUP_SCREENS ... = mock): the fake data lives in cookies of the browser, so every check is a real click and nothing is sent, called or paid. It prints one PASS or FAIL
// line per check, keeps a picture of every page (and of every failure), and exits 1 when a check failed.
//   1  sign-up: the cards end with ONE "Any business with leads", it shows the nine business cards, one of them leads to step 2
//   2  the setup wizard, steps 1 to 6 (paste a text, draft and approve a fact, edit the goal, the simulated test call, the go-live list, the skip links)
//   3  /import: a pasted list, the consent, the one-line preview, the import and the two ways on
//   4  /lead-sources: the website-form source, its secret shown ONCE with Copy, gone after a reload
//   5  /outreach/new: the plan card, one person left out, "Approve all", the progress, Pause and Continue; a standing rule
//   6  /lead-desk (Hot badge, source filter) and /lead-report (bars)
//   7  /tasks: a template chip, the plan, "Approve all", the progress, the short answer and the simulated transcript; the Ask orb in "Do it" mode
//   8  Settings > Plan: usage bars, top-up buttons, the TEST checkout sheet, the purchase recorded
//   9  the menu: the seven items, and the new tabs under Customers, Calls, Reports and Settings
// Every page is also checked for: no sideways scroll, no page or console error, a visible h1, no {token} left in the words, and gets a picture. Widths: laptop 1280x800 and phone 390x800.
//   node e2e/dr-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dr)
// Port 3018 (web) and 54999 (the stand-in): never run it at the same time as the other shots scripts; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dr"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3018;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { laptop: { width: 1280, height: 800, scale: 1 }, phone: { width: 390, height: 800, scale: 2 } };
// the "mock" flags: the fake data of each part lives in cookies of the browser (no backend needed). The first three are what dq-ask-shots sets for the Ask box.
const FLAGS = {
  ASSISTANT_SCREENS: "mock", CALL_SETTINGS_SCREENS: "mock", OWN_VOICE_SCREENS: "mock", MARKS_SCREENS: "mock", OUTCOME_SCREENS: "mock",
  LEADS_SCREENS: "mock", OUTREACH_SCREENS: "mock", TASK_SCREENS: "mock", TOPUP_SCREENS: "mock", VOICE_SAMPLE_SCREENS: "mock",
};

const b64url = (x) => Buffer.from(x).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("shots-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800, iat: 1790000000 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "shots-refresh", user: SESSION_USER }))}`;
}
const portBusy = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
  s.on("error", () => resolve(false));
});
async function waitForPort(port, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (p) => `${WEB_URL}/app/tenants/${TENANT}${p}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);

const results = [];
const written = [];
let picN = 0;
let browser = null;
const session = sessionCookieValue();

/** One named check: PASS or FAIL on its own line; a failure also keeps a picture of the page. Returns true when it passed. */
async function step(name, page, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
    return true;
  } catch (error) {
    const note = String(error?.message ?? error).split("\n")[0].slice(0, 400);
    results.push({ name, ok: false, note });
    console.log(`FAIL  ${name} :: ${note}`);
    if (page) {
      const file = path.join(OUT, `FAIL-${slug(name)}.png`);
      await page.screenshot({ path: file, fullPage: true }).then(() => written.push(`${path.basename(file)}  (failure: ${name})`), () => null);
    }
    return false;
  }
}
const expect = (cond, what) => {
  if (!cond) throw new Error(what);
};
/** Polls until `fn` answers something truthy (or the time is up). */
async function until(fn, ms, what) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`${what} (waited ${ms} ms)`);
}
async function shot(page, size, name, note) {
  const file = path.join(OUT, `${size}-${String(++picN).padStart(2, "0")}-${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => null);
  written.push(`${path.basename(file)}  (${note ?? name})`);
}

async function open(size, { signedIn = true } = {}) {
  const v = SIZES[size];
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, colorScheme: "light", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", permissions: ["clipboard-read", "clipboard-write"], isMobile: size === "phone", hasTouch: size === "phone" });
  context.setDefaultTimeout(15_000);
  const cookies = [{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sme_theme", value: "light", url: WEB_URL }];
  if (signedIn) cookies.push({ name: "sb-127-auth-token", value: session, url: WEB_URL });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|NotAllowedError/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 200)}`));
  return { context, page, errors, size };
}
/** Goes to an address and waits for the h1. */
async function go(page, url) {
  const res = await page.goto(url, { waitUntil: "load" });
  await page.locator("h1:visible").first().waitFor({ timeout: 25_000 });
  await hydrated(page);
  return res;
}
/** Waits until React has taken over the page (every form control and button in the main part has its handlers): a click or typing before that is lost or overwritten. */
async function hydrated(page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll("main button, main textarea, main select, main input, main a")].every((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), null, { timeout: 25_000 })
    .catch(() => null);
}
/** The checks every page gets: no sideways scroll, no page or console error, a visible h1 with words, no {token} on the page. Then a picture. */
async function basics(w, label, note) {
  const { page, errors, size } = w;
  await step(`[${size}] ${label}: page basics (no sideways scroll, no error, an h1)`, page, async () => {
    const issues = [];
    const dims = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
    if (dims.sw > dims.iw) issues.push(`the page scrolls sideways (${dims.sw} > ${dims.iw})`);
    const h1 = page.locator("h1:visible").first();
    const title = ((await h1.count()) ? await h1.innerText() : "").trim();
    if (!title) issues.push("no visible h1 with words");
    const text = await page.locator("body").innerText();
    if (/\{[a-z_]+\}/.test(text)) issues.push("a {token} is on the page");
    if (errors.length) issues.push(`errors: ${errors.join(" | ")}`);
    errors.length = 0;
    expect(issues.length === 0, issues.join("; "));
  });
  await shot(page, size, label, note);
}
const bodyText = (page) => page.locator("body").innerText();

// ---- 1. sign-up ----------------------------------------------------------------------------------------------------------------------------
async function signup(size) {
  const w = await open(size, { signedIn: false });
  const { page } = w;
  const tag = `[${size}] 1 sign-up`;
  await go(page, `${WEB_URL}/signup`);
  await basics(w, "1 signup step 1", "sign-up, step 1: the kinds of business");
  const cards = page.locator("[data-pack-card]");
  const last = page.locator("ul[aria-label] > li:last-child [data-pack-card]");
  await step(`${tag}: the cards end with ONE card 'Any business with leads'`, page, async () => {
    expect((await cards.count()) >= 2, "fewer than two cards");
    expect((await page.locator('[data-pack-card="leads"]').count()) === 1, `there are ${await page.locator('[data-pack-card="leads"]').count()} 'leads' cards, not one`);
    expect((await last.getAttribute("data-pack-card")) === "leads", "the last card is not the 'leads' card");
    expect((await last.innerText()).includes("Any business with leads"), `the last card says: ${(await last.innerText()).split("\n")[0]}`);
  });
  const opened = await step(`${tag}: the 'Any business with leads' card shows 9 business cards`, page, async () => {
    await last.click();
    await page.locator('[data-part="lead-templates"]').waitFor({ timeout: 20_000 });
    const n = await page.locator('[data-part="lead-templates"] li').count();
    expect(n === 9, `${n} business cards, not 9`);
  });
  if (opened) await basics(w, "1 signup the nine business cards", "sign-up: the nine business cards");
  if (opened) {
    let chosen = "";
    await step(`${tag}: choosing a business card goes to step 2 with data-chosen-pack`, page, async () => {
      const first = page.locator('[data-part="lead-templates"] [data-pack-card]').first();
      chosen = (await first.getAttribute("data-pack-card")) ?? "";
      await first.click();
      await page.locator("[data-chosen-pack]").waitFor({ timeout: 20_000 });
      expect((await page.locator("[data-chosen-pack]").getAttribute("data-chosen-pack")) === chosen, `chosen pack is not ${chosen}`);
      expect(page.url().includes(`type=${chosen}`), `the address does not carry type=${chosen}`);
      expect((await bodyText(page)).includes("Step 2 of 2"), "'Step 2 of 2' is missing");
    });
    await basics(w, "1 signup step 2", "sign-up, step 2: the chosen business type");
  }
  await w.context.close();
}

// ---- 2. the setup wizard -------------------------------------------------------------------------------------------------------------------
const SHOP_TEXT = "Sri Lakshmi Silks is a family saree shop in Hyderabad.\nWe sell Kanchi pattu and Mysore silk sarees for weddings and festivals.\nThe shop is open every day from 10 am to 8 pm.\nA Kanchi pattu bridal saree starts at ₹25,000.\nCall or WhatsApp us to book a visit.";
async function wizard(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 2 wizard`;
  const wiz = (n) => `${app("/lead-setup")}?step=${n}`;
  // step 1: paste, add, draft, approve
  await go(page, wiz(1));
  await step(`${tag} step 1: the progress bar and the 6 step links exist`, page, async () => {
    expect((await page.locator('[data-part="wizard"] progress').count()) === 1, "no progress bar");
    expect((await page.locator('[data-part="wizard"] ol li a').count()) === 6, `${await page.locator('[data-part="wizard"] ol li a').count()} step links, not 6`);
    expect((await page.locator('[data-part="wizard"] ol li a[aria-current="step"]').innerText()).startsWith("1"), "step 1 is not marked");
  });
  await basics(w, "2 wizard step 1 empty", "setup step 1, nothing added yet");
  const added = await step(`${tag} step 1: paste a text about a shop and 'Add this text'`, page, async () => {
    await page.getByLabel("Paste the text here").fill(SHOP_TEXT);
    await page.getByRole("button", { name: "Add this text" }).click();
    await page.locator("[data-source]").first().waitFor({ timeout: 20_000 });
  });
  if (added) {
    const drafted = await step(`${tag} step 1: 'Draft the facts' makes facts to check`, page, async () => {
      await page.getByRole("button", { name: "Draft the facts" }).click();
      await page.locator('[data-fact="draft"]').first().waitFor({ timeout: 20_000 });
      const n = await page.locator('[data-fact="draft"]').count();
      expect(n >= 3, `only ${n} drafted facts`);
    });
    if (drafted) {
      await step(`${tag} step 1: approve the first non-price fact and see 'Approved'`, page, async () => {
        const rows = page.locator('[data-fact="draft"]');
        const n = await rows.count();
        let pick = -1;
        for (let i = 0; i < n; i++) if (!/₹/.test(await rows.nth(i).innerText())) { pick = i; break; }
        expect(pick >= 0, "every drafted fact is a price");
        const text = (await rows.nth(pick).locator("p.break-words").innerText()).trim();
        await rows.nth(pick).getByRole("button", { name: "Approve", exact: true }).click();
        await page.locator('[data-fact="approved"]').first().waitFor({ timeout: 20_000 });
        const row = page.locator('[data-fact="approved"]').first();
        expect((await row.innerText()).includes("Approved"), "the approved fact does not say 'Approved'");
        expect((await row.innerText()).includes(text.slice(0, 20)), "the approved fact is not the one pressed");
        expect(/\(1 approved\)/.test(await bodyText(page)), "the heading does not say '(1 approved)'");
      });
    }
  }
  await basics(w, "2 wizard step 1 approved", "setup step 1: a fact approved");
  // step 2
  await go(page, wiz(2));
  await step(`${tag} step 2: 'Your kind of business' with a Next step link`, page, async () => {
    expect((await page.locator("h2").first().innerText()).includes("Your kind of business"), "the step title is missing");
    expect((await page.getByRole("link", { name: "Next step" }).count()) >= 1, "no 'Next step' link");
  });
  await basics(w, "2 wizard step 2", "setup step 2");
  // step 3: edit the goal and save
  await go(page, wiz(3));
  await step(`${tag} step 3: edit the goal sentence and Save`, page, async () => {
    const goal = page.getByLabel("The goal of the call");
    await goal.fill("Book a visit to the shop when they are ready.");
    await page.getByRole("button", { name: "Save goal and questions" }).click();
    await until(async () => /^Saved\./m.test(await bodyText(page)) || (await page.getByText(/Saved\. .* uses these from now on/).count()) > 0, 20_000, "no 'Saved.' note");
    await page.reload({ waitUntil: "load" });
    await page.locator("h1:visible").first().waitFor();
    await hydrated(page);
    expect((await page.getByLabel("The goal of the call").inputValue()) === "Book a visit to the shop when they are ready.", "the saved goal is not there after a reload");
  });
  await basics(w, "2 wizard step 3", "setup step 3: the goal saved");
  // step 4
  await go(page, wiz(4));
  await basics(w, "2 wizard step 4", "setup step 4: the assistant");
  // step 5: simulated test call
  await go(page, wiz(5));
  await step(`${tag} step 5: 'Try a test call (a simulation)' shows a transcript`, page, async () => {
    await page.getByRole("button", { name: "Try a test call (a simulation)" }).click();
    const box = page.locator('[data-part="wizard-test-call"] ol li');
    await box.first().waitFor({ timeout: 20_000 });
    expect((await box.count()) >= 2, "fewer than two transcript lines");
    expect(/Assistant:/.test(await page.locator('[data-part="wizard-test-call"]').innerText()), "no 'Assistant:' line");
  });
  await basics(w, "2 wizard step 5", "setup step 5: the simulated test call");
  // step 6: go-live list
  await go(page, wiz(6));
  await step(`${tag} step 6: the go-live list`, page, async () => {
    const n = await page.locator('[data-part="go-live"] ul').first().locator("li").count();
    expect(n >= 4, `${n} go-live rows, not 4`);
    expect((await page.getByRole("link", { name: "Open Lead Desk" }).count()) === 1, "no 'Open Lead Desk' link");
    expect((await page.getByRole("link", { name: "Connect lead sources" }).count()) === 1, "no 'Connect lead sources' link");
    expect((await page.locator('[data-part="go-live"]').innerText()).includes("1 facts you approved") || /1 fact/.test(await page.locator('[data-part="go-live"]').innerText()), "the approved fact is not counted in the list");
  });
  await basics(w, "2 wizard step 6", "setup step 6: go live");
  // the skip links, one after the other
  await go(page, wiz(1));
  await step(`${tag}: 'Skip this step' goes from step 1 to 6, step by step`, page, async () => {
    for (let n = 1; n <= 5; n++) {
      expect(page.url().includes(`step=${n}`), `expected step ${n}, at ${page.url()}`);
      await page.getByRole("link", { name: "Skip this step" }).click();
      await page.waitForURL(new RegExp(`step=${n + 1}$`), { timeout: 20_000 });
      await page.locator("h1:visible").first().waitFor();
    }
    expect((await page.getByRole("link", { name: "Skip this step" }).count()) === 0, "step 6 still offers 'Skip this step'");
  });
  await w.context.close();
}

// ---- 3. the import -------------------------------------------------------------------------------------------------------------------------
async function importList(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 3 import`;
  await go(page, app("/import"));
  await basics(w, "3 import start", "import: where is your list");
  const read = await step(`${tag}: paste a list of 5 lines and 'Read the list'`, page, async () => {
    await page.getByRole("radio", { name: "Paste a list" }).click();
    await page.getByLabel("Your list, one lead per line").fill(["Ravi Kumar, 90000 11111", "Anitha Rao, 98765 43210", "Kiran Patel, 91234 56780", "Ravi Kumar, 90000 11111", "Bad Number, 12345"].join("\n"));
    await page.getByRole("button", { name: "Read the list" }).click();
    await page.getByLabel("I confirm these people may be contacted for the reason below.").waitFor({ timeout: 20_000 });
  });
  if (read) {
    const checked = await step(`${tag}: tick the consent, fill the four facts, 'Check the list' gives the one-line count`, page, async () => {
      await page.getByLabel("I confirm these people may be contacted for the reason below.").check();
      await page.getByLabel("Name of this list").fill("Test list of shop visitors");
      await page.getByLabel("What you will contact them about").fill("Saree sale invitations");
      await page.getByLabel("How you got these numbers").fill("They wrote their number in our visitor book");
      await page.getByRole("button", { name: "Check the list" }).click();
      const line = page.locator("section[aria-labelledby=li-preview] p.text-lg");
      await line.waitFor({ timeout: 20_000 });
      const text = (await line.innerText()).trim();
      expect(/^\d+ ready( · .+)*$/.test(text), `the count line is "${text}"`);
      expect(/(\d+) ready/.exec(text)?.[1] === "3", `ready is not 3: "${text}"`);
      expect(/1 duplicates merged/.test(text), `no '1 duplicates merged': "${text}"`);
      expect(/1 invalid/.test(text), `no '1 invalid': "${text}"`);
    });
    await basics(w, "3 import preview", "import: the preview line");
    if (checked) {
      await step(`${tag}: 'Add these leads' ends on 'Start a campaign' and 'Tell Vijaya what to do'`, page, async () => {
        await page.getByRole("button", { name: "Add these leads" }).click();
        await page.getByText("Done. Your leads are in.").waitFor({ timeout: 20_000 });
        const campaign = page.getByRole("link", { name: "Start a campaign" });
        const tell = page.getByRole("link", { name: /^Tell .+ what to do$/ });
        expect((await campaign.count()) === 1, "no 'Start a campaign' button");
        expect((await tell.count()) === 1, "no 'Tell Vijaya what to do' button");
        expect(/\/outreach\/new\?source=/.test((await campaign.getAttribute("href")) ?? ""), "'Start a campaign' does not go to /outreach/new?source=");
        expect(/\/tasks\?new=1/.test((await tell.getAttribute("href")) ?? ""), "'Tell Vijaya ...' does not go to /tasks?new=1");
      });
      await basics(w, "3 import done", "import: done, with the two ways on");
      await step(`${tag}: 'Start a campaign' opens the plan form`, page, async () => {
        await page.getByRole("link", { name: "Start a campaign" }).click();
        await page.waitForURL(/\/outreach\/new\?source=/, { timeout: 20_000 });
        await page.getByRole("button", { name: "Make the plan" }).waitFor();
      });
    }
  }
  await w.context.close();
}

// ---- 4. lead sources -----------------------------------------------------------------------------------------------------------------------
async function leadSources(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 4 lead sources`;
  await go(page, app("/lead-sources"));
  await basics(w, "4 lead sources empty", "lead sources: nothing set up");
  let secret = "";
  const made = await step(`${tag}: create the website-form source and see its secret once, with a Copy button`, page, async () => {
    const card = page.locator("section[aria-labelledby=lsrc-website]");
    await card.getByRole("button", { name: "Set it up" }).click();
    await card.getByRole("button", { name: "Add this source" }).click();
    const region = page.getByRole("region", { name: "Copy it now: it is not shown again" });
    await region.waitFor({ timeout: 20_000 });
    secret = await region.locator("input[readonly]").first().inputValue();
    expect(/^https:\/\/.+\/lead-intake\/.{10,}/.test(secret), "the address in the secret box is not a lead-intake address");
    expect((await region.getByRole("button", { name: "Copy", exact: true }).count()) >= 1, "no Copy button");
    await region.getByRole("button", { name: "Copy", exact: true }).first().click();
    await region.getByRole("button", { name: "Copied" }).first().waitFor({ timeout: 5000 });
  });
  await basics(w, "4 lead sources secret shown", "lead sources: the secret shown once");
  if (made) {
    await step(`${tag}: after a reload the secret is gone (the source stays)`, page, async () => {
      await page.reload({ waitUntil: "load" });
      await page.locator("h1:visible").first().waitFor();
      expect((await page.getByRole("region", { name: "Copy it now: it is not shown again" }).count()) === 0, "the secret box is still shown after a reload");
      const token = secret.split("/").pop();
      const html = await page.content();
      expect(!html.includes(token), "the secret is still in the page after a reload");
      const card = page.locator("section[aria-labelledby=lsrc-website]");
      expect((await card.innerText()).includes("Its address ends in"), "the source does not show the end of its address");
      expect((await card.getByRole("button", { name: "Set it up" }).count()) >= 1, "the card does not offer a second source");
    });
    await basics(w, "4 lead sources after reload", "lead sources: after a reload the secret is gone");
  }
  await w.context.close();
}

// ---- 5. a plan for a batch, approve all, standing rule -----------------------------------------------------------------------------------------
async function outreach(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 5 outreach`;
  await go(page, `${app("/outreach/new")}?source=indiamart`);
  await basics(w, "5 outreach new", "outreach: make a plan");
  const planned = await step(`${tag}: 'Make the plan' lands on the plan card`, page, async () => {
    await page.getByRole("button", { name: "Make the plan" }).click();
    await page.waitForURL(/\/outreach\/batches\//, { timeout: 25_000 });
    await page.locator('[data-part="plan-card"]').waitFor({ timeout: 20_000 });
  });
  let count = 0;
  const approveBtn = () => page.getByRole("button", { name: /^Approve all \(\d+\)$/ });
  const countOf = async () => Number(/\((\d+)\)/.exec(await approveBtn().innerText())?.[1]);
  if (planned) {
    await basics(w, "5 outreach plan card", "outreach: the plan card");
    const unticked = await step(`${tag}: unticking one person lowers the Approve button count by one`, page, async () => {
      count = await countOf();
      expect(count >= 2, `the plan has only ${count} people`);
      await page.locator('[data-part="plan-card"] [data-part="who"] input[type="checkbox"]').first().click();
      await until(async () => (await countOf()) === count - 1, 15_000, `the button still says ${await countOf()} (was ${count})`);
    });
    if (unticked) {
      const approved = await step(`${tag}: 'Approve all' shows the progress 'N of M done'`, page, async () => {
        await approveBtn().click();
        await page.locator('[data-part="progress"]').waitFor({ timeout: 25_000 });
        expect(/\d+ of \d+ done/.test(await page.locator('[data-part="progress"]').innerText()), "no 'N of M done'");
        expect((await page.locator('[data-part="progress"] progress').count()) === 1, "no progress bar");
      });
      if (approved) {
        await basics(w, "5 outreach running", "outreach: approved, the progress");
        const doneNow = async () => Number(/(\d+) of \d+ done/.exec(await page.locator('[data-part="progress"] p[aria-live]').innerText())?.[1]);
        const paused = await step(`${tag}: Pause stops the plan and Continue starts it again`, page, async () => {
          await page.getByRole("button", { name: "Pause", exact: true }).click();
          await page.locator('[data-part="batch"][data-status="paused"]').waitFor({ timeout: 15_000 });
          await shot(page, size, "5 outreach paused", "outreach: paused");
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await page.locator('[data-part="batch"][data-status="running"]').waitFor({ timeout: 15_000 });
        });
        await step(`${tag}: the count moves on its own within 12 seconds`, page, async () => {
          const before = await doneNow();
          await until(async () => (await doneNow()) > before, 12_000, `the count stays at ${before}`);
        });
        void paused;
      }
    }
  }
  // a standing rule on /outreach
  await go(page, app("/outreach"));
  await basics(w, "5 outreach plans", "outreach: lead plans, hot leads and rules");
  await step(`${tag}: a standing rule for the website form ('Call within a few minutes') shows its sentence and 'Rule approved'`, page, async () => {
    await page.getByRole("button", { name: "Add a standing rule" }).click();
    await page.locator("#rf-source").selectOption({ label: "Your website form" });
    await page.getByRole("radio", { name: "Call within a few minutes" }).check();
    const sentence = (await page.locator('[data-part="rule-sentence"]').innerText()).trim();
    expect(/^New leads from Your website form: call within \d+ minutes, in calling hours\.$/.test(sentence), `the sentence is "${sentence}"`);
    await shot(page, size, "5 outreach rule form", "outreach: the standing rule form");
    await page.getByRole("button", { name: "Approve this rule" }).click();
    await page.getByText("Rule approved.", { exact: false }).first().waitFor({ timeout: 20_000 });
    const rule = page.locator('[data-rule="website_form"]');
    await rule.waitFor({ timeout: 20_000 });
    expect((await rule.innerText()).includes("call within"), "the rule is not listed with its sentence");
  });
  await basics(w, "5 outreach rule approved", "outreach: the rule approved");
  await w.context.close();
}

// ---- 6. lead desk and the report -------------------------------------------------------------------------------------------------------------
async function leadDesk(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 6 lead desk`;
  await go(page, app("/lead-desk"));
  const rows = () => page.locator('ul[data-part="leads"] > li[data-lead]');
  let all = 0;
  await step(`${tag}: leads are listed, at least one with a 'Hot' badge`, page, async () => {
    all = await rows().count();
    expect(all >= 2, `${all} leads listed`);
    const hot = await page.locator('ul[data-part="leads"] li span', { hasText: /^Hot$/ }).count();
    expect(hot >= 1, "no lead has a 'Hot' badge");
  });
  await basics(w, "6 lead desk", "lead desk: the leads, Hot badges");
  await step(`${tag}: the source filter narrows the list`, page, async () => {
    await page.getByLabel("Where from").selectOption({ label: "IndiaMART" });
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await page.waitForURL(/source=indiamart/, { timeout: 20_000 });
    await page.locator("h1:visible").first().waitFor();
    const n = await rows().count();
    expect(n >= 1 && n < all, `the filter shows ${n} of ${all}`);
    const texts = await rows().allInnerTexts();
    expect(texts.every((t) => t.includes("IndiaMART")), "a lead of another source is in the filtered list");
  });
  await basics(w, "6 lead desk filtered", "lead desk: filtered to IndiaMART");
  await go(page, app("/lead-report"));
  await step(`${tag} report: bars (progress elements) for the sources`, page, async () => {
    const n = await page.locator("main progress").count();
    expect(n >= 6, `${n} progress bars`);
    const text = await bodyText(page);
    expect(/Each source/.test(text), "no 'Each source' part");
    expect(/Meta lead ads/.test(text) && /IndiaMART/.test(text), "the sources are not named");
  });
  await basics(w, "6 lead report", "lead report: the bars");
  await w.context.close();
}

// ---- 7. tasks and the Ask box in "Do it" mode ------------------------------------------------------------------------------------------------
async function tasks(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 7 tasks`;
  await go(page, app("/tasks"));
  await basics(w, "7 tasks", "tasks: the box and the ready-made tasks");
  const planned = await step(`${tag}: a template chip fills the box and 'Make a plan' opens the plan card`, page, async () => {
    await page.getByRole("button", { name: "Supplier price enquiry" }).click();
    expect((await page.getByLabel("What should Vijaya do?").inputValue()).length > 20, "the chip did not fill the box");
    await page.getByRole("button", { name: "Make a plan" }).click();
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/, { timeout: 25_000 });
    await page.locator('[data-part="plan-card"]').waitFor({ timeout: 20_000 });
  });
  if (planned) {
    await basics(w, "7 task plan", "tasks: the plan card");
    const started = await step(`${tag}: 'Approve all' shows the progress`, page, async () => {
      await page.getByRole("button", { name: /^Approve all \(\d+\)$/ }).click();
      await page.locator('[data-part="live"]').waitFor({ timeout: 25_000 });
      expect(/\d+ of \d+/.test(await page.locator('[data-part="count"]').innerText()), "no 'N of M'");
      expect((await page.locator('[data-part="live"] progress').count()) === 1, "no progress bar");
    });
    if (started) {
      await shot(page, size, "7 task running", "tasks: running");
      await step(`${tag}: when it finishes the short answer and the report are shown (up to 40 s)`, page, async () => {
        await page.locator('[data-part="report"] [data-part="short-answer"]').waitFor({ timeout: 45_000 });
        const answer = (await page.locator('[data-part="short-answer"]').first().innerText()).trim();
        expect(answer.length > 5, "the short answer is empty");
        expect((await page.locator('[data-part="report"] [data-part="simulated"]').count()) >= 1, "the report does not say it is simulated");
      });
      await basics(w, "7 task report", "tasks: the report with the short answer");
      await step(`${tag}: the 'simulated' transcript opens`, page, async () => {
        const summary = page.locator("summary", { hasText: "Transcript (simulated)" }).first();
        await summary.scrollIntoViewIfNeeded();
        await summary.click();
        const list = summary.locator("xpath=following-sibling::ul[1]");
        await list.locator("li").first().waitFor({ state: "visible", timeout: 10_000 });
        expect((await list.locator("li").count()) >= 2, "fewer than two transcript lines");
        expect((await bodyText(page)).includes("Simulated: no real call was made."), "'Simulated' is not said next to the transcript");
      });
      await shot(page, size, "7 task transcript", "tasks: the simulated transcript open");
    }
  }
  // the Ask box on another page
  await go(page, app("/lead-desk"));
  await step(`${tag}: the Ask orb opens, 'Do it' shows the ready-made task chips`, page, async () => {
    await page.locator('[data-ask="orb"]').click();
    const panel = page.getByRole("dialog", { name: "Ask Vijaya" });
    await panel.waitFor({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Do it", exact: true }).click();
    const chips = panel.locator('[data-ask="chips"][data-ask-kind="tasks"] li');
    await chips.first().waitFor({ timeout: 15_000 });
    expect((await chips.count()) >= 5, `${await chips.count()} task chips`);
    await shot(page, size, "7 ask do it", "the Ask panel in 'Do it' mode with the task chips");
    await page.keyboard.press("Escape");
  });
  await basics(w, "7 ask orb page", "lead desk with the Ask orb");
  await w.context.close();
}

// ---- 8. Settings > Plan ------------------------------------------------------------------------------------------------------------------------
async function plan(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 8 plan`;
  await go(page, `${app("/settings")}?section=plan`);
  await step(`${tag}: usage bars and top-up buttons exist`, page, async () => {
    const meters = await page.locator('[role="meter"]').count();
    const packs = await page.locator("button[data-pack]").count();
    expect(meters >= 2, `${meters} usage bars`);
    expect(packs >= 6, `${packs} top-up buttons`);
  });
  await basics(w, "8 plan", "settings > plan: usage and top-ups");
  await step(`${tag}: a top-up button opens the TEST checkout sheet ('No money is taken')`, page, async () => {
    await page.locator("button[data-pack]").first().click();
    const sheet = page.locator("[data-checkout]");
    await sheet.waitFor({ timeout: 15_000 });
    const text = await sheet.innerText();
    expect(/No money is taken/.test(text), "'No money is taken' is missing");
    expect(/\bTEST\b/.test(text), "no TEST mark");
  });
  await shot(page, size, "8 plan checkout", "settings > plan: the TEST checkout sheet");
  await step(`${tag}: paying (test) is recorded`, page, async () => {
    const sheet = page.locator("[data-checkout]");
    await sheet.getByRole("button", { name: /^Pay .+ \(test\)$/ }).click();
    await sheet.getByRole("status").waitFor({ timeout: 20_000 });
    expect(/^Done:/.test((await sheet.getByRole("status").innerText()).trim()), "the sheet does not say 'Done:'");
    await sheet.getByRole("button", { name: "Close" }).click();
    await page.locator("[data-purchase]").first().waitFor({ timeout: 15_000 });
    expect(/Top-ups bought/.test(await bodyText(page)), "no 'Top-ups bought' part");
  });
  await basics(w, "8 plan bought", "settings > plan: the top-up recorded");
  await w.context.close();
}

// ---- 9. the menu -----------------------------------------------------------------------------------------------------------------------------
async function menu(size) {
  const w = await open(size);
  const { page } = w;
  const tag = `[${size}] 9 menu`;
  const strip = page.getByRole("navigation", { name: "Parts of this section" });
  const tabs = async () => (await strip.getByRole("link").allInnerTexts()).map((s) => s.trim());
  await go(page, app("/lead-desk"));
  await step(`${tag}: the seven items (Today, Customers, Chats, Calls, Sales, Catalogue, Reports)`, page, async () => {
    const clean = (s) => s.replace(/\s*Waiting for you:\s*\d+/, "").trim();
    if (size === "laptop") {
      const items = (await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("link").allInnerTexts()).map(clean);
      expect(items.join("|") === "Today|Customers|Chats|Calls|Sales|Catalogue|Reports", `the items are ${items.join(", ")}`);
      expect((await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("link", { name: "Customers" }).getAttribute("aria-current")) === "page", "Customers is not marked on Lead Desk");
    } else {
      const bar = (await page.getByRole("navigation", { name: "Quick menu" }).getByRole("link").allInnerTexts()).map(clean);
      await page.getByRole("navigation", { name: "Quick menu" }).getByRole("button", { name: "More" }).click();
      const sheet = (await page.getByRole("dialog").getByRole("link").allInnerTexts()).map((s) => s.trim());
      await shot(page, size, "9 menu more", "the phone's More sheet");
      await page.keyboard.press("Escape");
      const top = [...bar, ...sheet.filter((s) => !["Settings", "Help"].includes(s) && !/Silks/.test(s))];
      expect(top.join("|") === "Today|Customers|Chats|Sales|Calls|Catalogue|Reports", `the phone's items are ${top.join(", ")}`);
    }
  });
  const want = [
    ["/lead-desk", "Customers", ["Lead Desk", "Add leads"], "lead-desk"],
    ["/import", "Customers", ["Lead Desk", "Add leads"], "import"],
    ["/outreach", "Calls", ["Lead plans", "Tasks"], "outreach"],
    ["/tasks", "Calls", ["Lead plans", "Tasks"], "tasks"],
    ["/lead-report", "Reports", ["Lead report"], "lead-report"],
    ["/lead-sources", "Settings", ["Lead sources"], "lead-sources"],
  ];
  for (const [route, group, labels, name] of want) {
    await go(page, app(route));
    await step(`${tag}: ${route} has the tabs ${labels.join(" + ")} (${group})`, page, async () => {
      const got = await tabs();
      for (const l of labels) expect(got.includes(l), `the tab '${l}' is missing; the tabs are ${got.join(", ")}`);
      const current = await strip.locator('a[aria-current="page"]').allInnerTexts();
      expect(current.length === 1 && labels.includes(current[0].trim()), `the marked tab is '${current.join(", ")}'`);
      // the tabs row must scroll or wrap, never break the layout
      const fit = await strip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { scroll: el.scrollWidth > el.clientWidth + 1, overflowX: cs.overflowX, wrap: cs.flexWrap, left: r.left, right: r.right, inner: window.innerWidth, page: document.scrollingElement.scrollWidth };
      });
      expect(fit.page <= fit.inner, `the page scrolls sideways (${fit.page} > ${fit.inner})`);
      expect(!fit.scroll || ["auto", "scroll"].includes(fit.overflowX), `the tabs row overflows (${fit.overflowX}) and does not scroll`);
      expect(fit.left >= 0 && fit.right <= fit.inner + 1, "the tabs row sticks out of the screen");
      const cur = strip.locator('a[aria-current="page"]');
      const box = await cur.boundingBox();
      expect(box !== null && box.x >= -1 && box.x + box.width <= fit.inner + 1, `the marked tab is scrolled out of sight (x ${box && Math.round(box.x)}, width ${box && Math.round(box.width)})`);
    });
    await basics(w, `9 menu tabs ${name}`, `the tabs of ${group} on ${route}`);
  }
  await w.context.close();
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dr-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("dr-shots: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  // the stand-in says Vijaya is "not built yet", so the Ask box would not be drawn; here the main assistant is on (the same list, one state changed)
  const agents = [{ agent: "main", state: "idle", job: "Coordinates the other helpers.", last_event: null }, ...["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"].map((agent, i) => ({ agent, state: i === 2 ? "working" : i === 0 ? "not_available" : "idle", job: `The ${agent.replace("_", " ")} helper.`, last_event: null }))];
  const json = (res, body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: [
    ["GET", new RegExp(`^/v1/tenants/${TENANT}/billing/access$`), (_req, res) => json(res, { access: "full", read_only_since: null, delete_on: null, data_days_left: null, can_resume: false, sending: "on", waiting_for: null })],
    ["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/status$`), (_req, res) => json(res, agents)],
  ] });
  let web = null;
  const stopWeb = async () => {
    if (!web) return;
    web.kill("SIGTERM"); // our own child, by its own process id
    await new Promise((r) => web.on("exit", r));
    web = null;
    await sleep(400);
  };
  try {
    // no fake clock here: the mock plans and tasks move by the real clock (one person every 3 s / 2 s)
    const env = { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem") };
    delete env.NODE_OPTIONS;
    Object.assign(env, FLAGS);
    web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], { cwd: WEB_DIR, env, stdio: "ignore" });
    await waitForPort(WEB_PORT);
    browser = await chromium.launch();
    const parts = [signup, wizard, importList, leadSources, outreach, leadDesk, tasks, plan, menu];
    for (const size of Object.keys(SIZES)) {
      for (const part of parts) {
        try {
          await part(size);
        } catch (error) {
          const note = String(error?.message ?? error).split("\n")[0].slice(0, 400);
          results.push({ name: `[${size}] ${part.name}: the check crashed`, ok: false, note });
          console.log(`FAIL  [${size}] ${part.name}: the check crashed :: ${note}`);
        }
      }
    }
  } catch (error) {
    results.push({ name: "setup", ok: false, note: error.message });
    console.error(`dr-shots: ${error.message}`);
  } finally {
    await browser?.close().catch(() => null);
    await stopWeb();
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n\n${results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : ` :: ${r.note}`}`).join("\n")}\n`);
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL; ${written.length} pictures in ${OUT}`);
  for (const r of failed) console.log(`  FAIL  ${r.name} :: ${r.note}`);
  if (failed.length) process.exitCode = 1;
}

main();
