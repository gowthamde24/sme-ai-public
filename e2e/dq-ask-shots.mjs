// Job DQ part 0 (fix-today-ask, owner feedback of 26 Oct): the assistant and the menu in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). It CHECKS what it shows and exits 1:
//  - Today: exactly ONE text input, in the assistant's card, with the placeholder "Ask Vijaya anything, in any language…"; the three chips answer in the card; no floating orb; no bar fixed to the bottom;
//  - every other screen: no bar; a 56 px orb at the bottom right; it opens a dialog (about 380 x 560 on a laptop, a sheet about 70 % high on a phone) with the chips of that screen; an answer appears; Esc and Close return to the orb;
//  - ONE conversation: a question asked in the panel on Leads is on Today, with "Show earlier" for the one before; "/" and Ctrl+K open the panel;
//  - the menu: at most seven items at desktop and phone; the tabs of Sales, Chats and Settings;
//  - "Your team": no label is cut off or overlaps another, at both widths.
//   node e2e/dq-ask-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dq-ask)
// Port 3017 (web) and 54999 (the stand-in): never run it at the same time as the other shots scripts; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, LEAD, PACK_STATE, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dq-ask"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3017;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };

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
async function waitForPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const FLAGS = { ASSISTANT_SCREENS: "mock", CALL_SETTINGS_SCREENS: "mock", OWN_VOICE_SCREENS: "mock", MARKS_SCREENS: "mock", OUTCOME_SCREENS: "mock" };
const LANGS = ["te", "hi", "kn"];
const app = (p) => `${WEB_URL}/app/tenants/${TENANT}${p}`;

let readOnly = false;
async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dq-ask-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("dq-ask-shots: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  // the stand-in says Vijaya is "not built yet", so the Ask box would not be drawn; for these pictures the main assistant is on (the same list, one state changed)
  const agents = [{ agent: "main", state: "idle", job: "Coordinates the other helpers.", last_event: null }, ...["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"].map((agent, i) => ({ agent, state: i === 2 ? "working" : i === 0 ? "not_available" : "idle", job: `The ${agent.replace("_", " ")} helper.`, last_event: null }))];
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: [["GET", new RegExp(`^/v1/tenants/${TENANT}/billing/access$`), (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(readOnly ? { access: "read_only", read_only_since: "2026-10-20", delete_on: "2027-01-18", data_days_left: 84, can_resume: true, sending: "off", waiting_for: null } : { access: "full", read_only_since: null, delete_on: null, data_days_left: null, can_resume: false, sending: "on", waiting_for: null })); }], ["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/status$`), (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(agents)); }]] });
  const written = [];
  const problems = [];
  const check = (ok, what) => {
    if (!ok) problems.push(what);
  };
  let web = null;
  const startWeb = async (flags) => {
    const env = { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW };
    for (const k of Object.keys(FLAGS)) delete env[k];
    Object.assign(env, flags);
    web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], { cwd: WEB_DIR, env, stdio: "ignore" });
    await waitForPort(WEB_PORT);
  };
  const stopWeb = async () => {
    if (!web) return;
    web.kill("SIGTERM"); // our own child, by its own process id
    await new Promise((r) => web.on("exit", r));
    web = null;
    await sleep(400);
  };
  let browser = null;
  const session = sessionCookieValue();
  const open = async ({ scheme, sizeName, lang }) => {
    const size = SIZES[sizeName];
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", permissions: ["microphone"], isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
    await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sme_theme", value: scheme, url: WEB_URL }, { name: "sb-127-auth-token", value: session, url: WEB_URL }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|NotAllowedError/.test(m.text()) && errors.push(m.text().slice(0, 200)));
    return { context, page, errors };
  };
  const common = async (tag, label, page, errors, sizeName, opts = {}) => {
    const text = await page.locator("body").innerText();
    if (sizeName === "phone") check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${label}: the page scrolls sideways at 390 px`);
    check(errors.length === 0, `${tag} ${label}: console errors: ${errors.join(" | ")}`);
    check(!/\{[a-z_]+\}/.test(text), `${tag} ${label}: a {token} is on the page`);
    check((await page.locator('img[src*="owl"]').count()) === 0, `${tag} ${label}: an owl picture is on the page`);
    if (opts.noMoney) check(!/₹|\bRs\.?\s?\d/.test(text), `${tag} ${label}: money is on the public site`);
    return text;
  };
  const save = async (page, name, tag, note, opts = {}) => {
    const file = path.join(OUT, `${name}-${tag}.png`);
    await page.screenshot({ path: file, fullPage: true, ...opts });
    written.push(`${path.basename(file)}  (${note})`);
  };
  const has = (tag, label, text, words) => {
    for (const w of words) check(text.toLowerCase().includes(w.toLowerCase()), `${tag} ${label}: "${w}" is missing`);
  };
  try {
    browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
    await startWeb({ ASSISTANT_SCREENS: "mock", CALL_SCREENS: "mock" });
    const ANSWER = "Two quotes wait for your OK and one customer asked for a call. Nothing else needs you today.";
    const answerFor = (route) => route.fulfill({ status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" }, body: [{ type: "text", delta: "Two quotes wait for your OK and one customer asked for a call. " }, { type: "text", delta: "Nothing else needs you today." }, { type: "done" }].map((e) => JSON.stringify(e)).join("\n") + "\n" });
    const fixedForms = (page) => page.evaluate(() => [...document.querySelectorAll("form")].filter((f) => getComputedStyle(f).position === "fixed" || f.closest("[data-dock]")).length);
    const textInputs = (page) => page.locator('input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"])').count();

    for (const sizeName of Object.keys(SIZES)) {
      const tag = `light-${sizeName}-en`;
      const view = SIZES[sizeName];

      // 1. Today: the card IS the assistant
      {
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        await page.route("**/tenants/*/ask", answerFor);
        await page.goto(app(""), { waitUntil: "networkidle" });
        const text = await common(tag, "today", page, errors, sizeName);
        const card = page.locator('[data-part="agent-owl"]');
        check((await textInputs(page)) === 1, `${tag} today: not exactly one text input (${await textInputs(page)})`);
        check((await card.locator("input#ask-input").count()) === 1, `${tag} today: the one input is not in the assistant's card`);
        check((await card.locator("input#ask-input").getAttribute("placeholder")) === "Ask Vijaya anything, in any language…", `${tag} today: the placeholder is not the owner's`);
        check((await page.locator('[data-ask="orb"]').count()) === 0, `${tag} today: the floating orb is on Today`);
        check((await fixedForms(page)) === 0, `${tag} today: a form is fixed to the screen (a bottom bar)`);
        check((await page.locator("[data-dock]").count()) === 0, `${tag} today: the dock is drawn`);
        has(tag, "today", text, ["What needs me today?", "Who should I call first?", "How much customer money is held?"]);
        await save(page, "today-card", tag, "Today: the input is inside the assistant's card, with the chips under it", { fullPage: false });
        await card.getByRole("button", { name: "What needs me today?" }).click();
        await card.getByText("Nothing else needs you today.").waitFor({ timeout: 15000 });
        check((await card.getByText(/You asked: What needs me today\?/).count()) === 1, `${tag} today: the question is not shown in the card`);
        await card.getByRole("button", { name: "Who should I call first?" }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-part="agent-owl"] [data-ask="answer"]').length === 1);
        await card.getByRole("button", { name: /Show earlier \(1\)/ }).waitFor({ timeout: 15000 });
        await save(page, "today-card-answer", tag, "Today: the answer in the card, 'Show earlier' for the one before", { fullPage: false });
        check(errors.length === 0, `${tag} today: console errors ${errors.join(" | ")}`);
        await context.close();
      }

      // 2. another screen: the orb, the panel, one conversation, no bar
      {
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        await page.route("**/tenants/*/ask", answerFor);
        await page.goto(app(`/leads/${LEAD}`), { waitUntil: "networkidle" });
        const orb = page.locator('[data-ask="orb"]');
        await orb.waitFor({ timeout: 20000 }).catch(async (e) => {
          const seen = await page.evaluate(() => ({ url: location.pathname, asks: [...document.querySelectorAll("[data-ask]")].map((x) => x.getAttribute("data-ask")), text: document.body.innerText.slice(0, 300) }));
          throw new Error(`${tag} leads: no orb (${JSON.stringify(seen)}; errors ${errors.join(" | ")}); ${e.message.split("\n")[0]}`);
        });
        const box = await orb.boundingBox();
        check(box !== null && Math.round(box.width) === 56 && Math.round(box.height) === 56, `${tag} leads: the orb is not 56 px (${box && Math.round(box.width)}x${box && Math.round(box.height)})`);
        check(box !== null && box.x + box.width > view.width - 40 && box.y + box.height > view.height - 160 && box.y + box.height <= view.height, `${tag} leads: the orb is not at the bottom right (${box && Math.round(box.x)},${box && Math.round(box.y)})`);
        if (sizeName === "phone") {
          const bar = await page.locator('nav[aria-label="Quick menu"]').boundingBox();
          check(bar !== null && box !== null && box.y + box.height <= bar.y + 1, `${tag} leads: the orb is over the phone's bottom bar`);
        }
        check((await fixedForms(page)) === 0, `${tag} leads: a form is fixed to the screen (a bottom bar)`);
        await save(page, "orb-leads", tag, "Leads: the floating orb at the bottom right, no bar", { fullPage: false });
        await orb.click();
        const panel = page.getByRole("dialog", { name: "Ask Vijaya" });
        await panel.waitFor({ timeout: 15000 });
        const pb = await panel.boundingBox();
        if (sizeName === "desktop") check(pb !== null && Math.round(pb.width) === 380 && pb.height >= 480 && pb.height <= 560, `${tag} leads: the panel is not about 380 x 560 (${pb && Math.round(pb.width)}x${pb && Math.round(pb.height)})`);
        else check(pb !== null && Math.abs(pb.height / view.height - 0.7) < 0.03 && Math.abs(pb.y + pb.height - view.height) <= 1 && pb.width >= view.width - 1, `${tag} leads: the panel is not a sheet 70 % high from the bottom (${pb && Math.round(pb.height)} of ${view.height})`);
        check(await page.evaluate(() => document.activeElement?.id === "ask-input"), `${tag} leads: the line does not have the focus when the panel opens`);
        const chips = (await panel.locator('[data-ask="chips"] li').allInnerTexts()).map((s) => s.trim());
        check(chips[0] === "Who should I call first?", `${tag} leads: the first chip is not "Who should I call first?" (${chips.join(" | ")})`);
        await save(page, "panel-open", tag, "Leads: the panel open with the chips of the screen", { fullPage: false });
        await panel.getByRole("button", { name: "Who should I call first?" }).click();
        await panel.getByText("Nothing else needs you today.").waitFor({ timeout: 15000 });
        await panel.getByRole("textbox").fill("Which quotes are open?");
        await page.keyboard.press("Enter");
        await panel.getByText(/You asked: Which quotes are open\?/).waitFor({ timeout: 15000 });
        await save(page, "panel-answer", tag, "Leads: an answer in the panel", { fullPage: false });
        await page.keyboard.press("Escape");
        check((await page.getByRole("dialog").count()) === 0, `${tag} leads: Escape did not close the panel`);
        check(await page.waitForFunction(() => document.activeElement?.getAttribute("data-ask") === "orb", null, { timeout: 5000 }).then(() => true, () => false), `${tag} leads: the focus did not return to the orb`);
        // "/" opens it again, Close closes it
        await page.keyboard.press("/");
        await panel.waitFor({ timeout: 10000 });
        await panel.getByRole("button", { name: "Close" }).click();
        check((await page.getByRole("dialog").count()) === 0, `${tag} leads: Close did not close the panel`);
        await page.keyboard.press("Control+k");
        await panel.waitFor({ timeout: 10000 });
        await page.keyboard.press("Escape");
        // the same conversation on Today (a move inside the app, so the exchange stays)
        if (sizeName === "desktop") await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("link", { name: "Today" }).click();
        else await page.getByRole("navigation", { name: "Quick menu" }).getByRole("link", { name: /Today/ }).click();
        await page.locator('[data-part="agent-owl"]').waitFor({ timeout: 20000 });
        const card = page.locator('[data-part="agent-owl"]');
        check((await card.getByText(/You asked: Which quotes are open\?/).count()) === 1, `${tag} today after leads: the question asked on Leads is not on Today`);
        check((await card.getByText("Nothing else needs you today.").count()) >= 1, `${tag} today after leads: the answer is not on Today`);
        await card.getByRole("button", { name: /Show earlier \(1\)/ }).click();
        check((await card.getByText(/You asked: Who should I call first\?/).count()) === 1, `${tag} today after leads: the earlier question is not under 'Show earlier'`);
        check((await page.locator('[data-ask="orb"]').count()) === 0, `${tag} today after leads: the orb is on Today`);
        await save(page, "today-after-leads", tag, "Today: the exchange asked on Leads is in the card", { fullPage: false });
        check(errors.length === 0, `${tag} panel: console errors ${errors.join(" | ")}`);
        await context.close();
      }

      // 3. no bar on any page; the orb on the screens, not on the live call
      {
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        for (const route of ["", `/leads/${LEAD}`, "/visits", "/outbox", "/catalogue", "/settings", "/team", "/office", "/office/live"]) {
          await page.goto(app(route), { waitUntil: "networkidle" });
          check((await fixedForms(page)) === 0, `${tag} ${route || "/"}: a form is fixed to the screen (a bottom bar)`);
          check((await page.locator("[data-dock]").count()) === 0, `${tag} ${route || "/"}: the dock is drawn`);
          if (route === "" || route === "/office/live") check((await page.locator('[data-ask="orb"]').count()) === 0, `${tag} ${route || "/"}: the orb is on this screen`);
          else check((await page.locator('[data-ask="orb"]').count()) === 1, `${tag} ${route}: the orb is missing`);
        }
        check(errors.filter((e) => !/404/.test(e)).length === 0, `${tag} bar: console errors ${errors.join(" | ")}`);
        await context.close();
      }

      // 4. the menu: seven items; the tabs of Sales, Chats and Settings
      {
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        await page.goto(app("/visits"), { waitUntil: "networkidle" });
        if (sizeName === "desktop") {
          const items = (await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("link").allInnerTexts()).map((s) => s.replace(/\s*Waiting for you:\s*\d+/, "").trim());
          check(items.length <= 7, `${tag} menu: ${items.length} items (${items.join(", ")})`);
          check(items.join("|") === "Today|Customers|Chats|Calls|Sales|Catalogue|Reports", `${tag} menu: the items are ${items.join(", ")}`);
          check((await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("link", { name: "Sales" }).getAttribute("aria-current")) === "page", `${tag} menu: Sales is not marked on Store visits`);
        } else {
          const bar = (await page.getByRole("navigation", { name: "Quick menu" }).getByRole("link").allInnerTexts()).map((s) => s.replace(/\s*Waiting for you:\s*\d+/, "").trim());
          await page.getByRole("navigation", { name: "Quick menu" }).getByRole("button", { name: "More" }).click();
          const sheet = (await page.getByRole("dialog").getByRole("link").allInnerTexts()).map((s) => s.trim());
          const top = [...bar, ...sheet.filter((s) => !["Settings", "Help"].includes(s) && !/Silks/.test(s))];
          check(top.length <= 7, `${tag} menu: ${top.length} items on the phone (${top.join(", ")})`);
          check(top.join("|") === "Today|Customers|Chats|Sales|Calls|Catalogue|Reports", `${tag} menu: the phone's items are ${top.join(", ")}`);
          await save(page, "menu-more", tag, "the phone's More sheet: Calls, Catalogue, Reports, Settings", { fullPage: false });
          await page.keyboard.press("Escape");
        }
        const strip = (label) => page.getByRole("navigation", { name: "Parts of this section" }).getByRole("link", label ? { name: label } : undefined);
        check((await strip().allInnerTexts()).map((s) => s.trim()).join("|") === "Quotes|Store visits|Orders", `${tag} visits: the tabs are not Quotes, Store visits, Orders (${(await strip().allInnerTexts()).join("|")})`);
        check((await strip("Store visits").getAttribute("aria-current")) === "page", `${tag} visits: the Store visits tab is not marked`);
        await save(page, "tabs-sales", tag, "Store visits with the tabs of Sales", { fullPage: false });
        await page.goto(app("/outbox"), { waitUntil: "networkidle" });
        check((await strip().allInnerTexts()).map((s) => s.trim()).join("|") === "Customer chats|Outbox", `${tag} outbox: the tabs are not Customer chats, Outbox`);
        await page.goto(app("/team"), { waitUntil: "networkidle" });
        check((await strip().allInnerTexts()).map((s) => s.trim()).join("|") === "Settings|Team|Office|Integrations", `${tag} team: the tabs are not Settings, Team, Office, Integrations`);
        await save(page, "tabs-settings", tag, "Team with the tabs of Settings", { fullPage: false });
        // the moved pages keep their addresses and still open
        for (const route of ["/office", "/integrations", "/team", "/followups", "/outbox", "/report"]) {
          const res = await page.goto(app(route), { waitUntil: "networkidle" });
          check(res !== null && res.status() === 200, `${tag} ${route}: status ${res && res.status()}`);
        }
        check(errors.filter((e) => !/404/.test(e)).length === 0, `${tag} menu: console errors ${errors.join(" | ")}`);
        await context.close();
      }

      // 5. "Your team": nothing cut off, nothing over anything else
      {
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
        await page.goto(app(""), { waitUntil: "networkidle" });
        const team = page.locator('[data-part="team-list"]');
        await team.scrollIntoViewIfNeeded();
        const rows = team.locator("li");
        const n = await rows.count();
        check(n >= 1, `${tag} team: no helper rows`);
        for (let i = 0; i < n; i++) {
          const row = rows.nth(i);
          const parts = await row.evaluate((li) => {
            const name = li.querySelector('[data-part="team-name"]');
            const status = li.querySelector('[data-part="team-status"]');
            const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, sw: el.scrollWidth, cw: el.clientWidth }; };
            const l = li.getBoundingClientRect();
            return { row: { left: l.left, right: l.right }, name: rect(name), status: rect(status) };
          });
          check(parts.name.bottom <= parts.status.top + 1, `${tag} team row ${i}: the name overlaps the status line`);
          check(parts.status.right <= parts.row.right + 1 && parts.name.right <= parts.row.right + 1, `${tag} team row ${i}: a label runs out of its row`);
          check(parts.status.sw <= parts.status.cw + 1, `${tag} team row ${i}: the status line is cut off`);
        }
        await save(page, "today-team", tag, "Today: the Your team card, every label whole", { fullPage: false });
        check(errors.length === 0, `${tag} team: console errors ${errors.join(" | ")}`);
        await context.close();
      }
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`dn-shots: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => null);
    await stopWeb();
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n${problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : ""}`);
  console.log(`${written.length} pictures in ${OUT}${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();



