// Job DP (night of 26 Oct): the night's screens in a real browser, on the real production web app and the visual tests' invented backend (e2e/visual/stand-in.mjs). It CHECKS what it shows and exits 1 with the list if one fails:
//  - the landing page (Lead Desk, night 4: the "Natural AI calls" block with "Calls in your own voice" is no longer on it) in four languages;
//  - Settings > AI assistant: the Advanced call settings (closed, opened, a change saved and kept), the own-voice card (name, the sentence, a recorded sentence and sample, create, the voice is chosen among the voices, delete);
//  - a school's "Send marks to parents" (the note that marks are not stored, a file, the preview, the send, the log);
//  - a READ-ONLY workspace: the one notice, every main button off, the person's own Settings parts still on, the way to pay again.
// The new screens run behind CALL_SETTINGS_SCREENS, OWN_VOICE_SCREENS, MARKS_SCREENS, ASSISTANT_SCREENS = mock (fake data kept in cookies: nothing is called, nothing is stored on a server).
//   node e2e/dp-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dp)
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
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dp"));
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dp-shots-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("dp-shots: building the web app (a minute or two)");
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
    const sizes = Object.keys(SIZES);

    // 1. the landing page (reworked for Lead Desk in night 4: the natural-calls block is gone, the own voice lives in Settings > AI assistant, checked in part 2), in four languages
    await startWeb(FLAGS);
    for (const lang of ["en", ...LANGS]) {
      for (const sizeName of sizes) {
        const tag = `light-${sizeName}-${lang}`;
        const { context, page, errors } = await open({ scheme: "light", sizeName, lang });
        await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
        const text = await common(tag, "landing", page, errors, sizeName, { noMoney: true });
        if (lang === "en") has(tag, "landing", text, ["calls your leads in 2 minutes", "A lead arrives"]);
        else check(!/calls your leads in 2 minutes/.test(text), `${tag} landing: the English headline is on the ${lang} page`);
        check((await page.locator('[data-part="ld-steps"] li').count()) === 6, `${tag} landing: the six Lead Desk steps are missing`);
        check((await page.locator("#voice").count()) === 0, `${tag} landing: the natural calls block is still on the page`);
        if (lang === "en") await save(page, "landing-lead-desk", tag, "the home page: the six steps of Lead Desk", { fullPage: false });
        await context.close();
      }
    }

    // 2. Settings > AI assistant: Advanced call settings and the own voice
    for (const sizeName of sizes) {
      const tag = `light-${sizeName}-en`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
      await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
      const text = await common(tag, "assistant", page, errors, sizeName);
      has(tag, "assistant", text, ["Set up your AI assistant", "Advanced: how calls behave", "Use my own voice"]);
      const adv = page.locator('details[data-settings="call-settings"]');
      check(((await adv.getAttribute("open")) ?? null) === null, `${tag} advanced: it is open before anyone opened it`);
      await save(page, "assistant-closed", tag, "Settings > AI assistant: Advanced is closed, own voice below it");
      await adv.locator("summary").click();
      await page.getByLabel("Tries (0 = never again)").first().fill("4");
      await page.getByRole("button", { name: "Add", exact: true }).first().click();
      await page.getByLabel("Written").first().fill("Kanchipuram");
      await page.getByLabel("Said as").first().fill("Kanchi-puram");
      await save(page, "assistant-advanced-open", tag, "Advanced call settings opened, two changes made");
      await adv.getByRole("button", { name: "Save call settings" }).click();
      await adv.getByText("Saved.").waitFor({ timeout: 15000 });
      await page.reload({ waitUntil: "networkidle" });
      await page.locator('details[data-settings="call-settings"] summary').click();
      check((await page.getByLabel("Tries (0 = never again)").first().inputValue()) === "4", `${tag} advanced: the saved retry count did not come back`);
      check((await page.getByLabel("Written").first().inputValue()) === "Kanchipuram", `${tag} advanced: the saved pronunciation did not come back`);
      check(errors.length === 0, `${tag} advanced: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    {
      // the own voice, on a laptop: a recorded sentence and a 16 second sample from the browser's fake microphone, created, chosen, deleted
      const tag = "light-desktop-en";
      const { context, page, errors } = await open({ scheme: "light", sizeName: "desktop", lang: "en" });
      await page.goto(app("/settings?section=assistant"), { waitUntil: "networkidle" });
      const card = page.locator('[data-settings="own-voice"]');
      await page.getByLabel("Your full name (it is part of the consent)").fill("Anil Reddy");
      await page.getByRole("button", { name: "Show the sentence" }).click();
      await card.locator('[data-part="consent-sentence"]').waitFor({ timeout: 15000 });
      check(/^I, Anil Reddy, allow Stack19 to create an AI voice of me for /.test(await card.locator('[data-part="consent-sentence"]').innerText()), `${tag} own voice: the consent sentence is not the fixed one`);
      await page.getByRole("button", { name: "Record the sentence" }).click();
      await page.waitForTimeout(6500);
      await page.getByRole("button", { name: "Stop" }).click();
      await page.getByRole("button", { name: "Record the sample" }).click();
      await page.waitForTimeout(16500);
      await page.getByRole("button", { name: "Stop" }).click();
      await page.getByText(/seconds recorded/).first().waitFor({ timeout: 10000 });
      await card.locator("audio").nth(1).waitFor({ timeout: 10000 });
      check((await card.locator("audio").count()) === 2, `${tag} own voice: both recordings should have a player`);
      await save(page, "own-voice-recorded", tag, "own voice: the sentence and the sample recorded and ready to create");
      await page.getByRole("button", { name: "Create my voice" }).click();
      await card.locator('[data-part="own-voice-ready"]').waitFor({ timeout: 20000 });
      has(tag, "own voice", await card.innerText(), ["Your own voice", "Made with the consent of Anil Reddy", "Delete my voice", "Deleting removes the voice and both recordings."]);
      check((await page.getByRole("radio", { name: /My own voice/ }).count()) === 1, `${tag} own voice: "My own voice" is not among the voices`);
      await save(page, "own-voice-ready", tag, "own voice: made, with who consented and when");
      await card.getByRole("button", { name: "Delete my voice" }).click();
      check((await card.getByRole("alertdialog").innerText()).includes("removes the voice and both recordings"), `${tag} own voice: the question does not say what goes`);
      await card.getByRole("button", { name: "Yes, delete it" }).click();
      await page.getByText("Your voice and both recordings were deleted.").waitFor({ timeout: 15000 });
      check((await page.getByRole("radio", { name: /My own voice/ }).count()) === 0, `${tag} own voice: "My own voice" is still a choice after deleting`);
      check(errors.length === 0, `${tag} own voice: console errors ${errors.join(" | ")}`);
      await context.close();
    }

    // 3. a school: Send marks to parents
    Object.assign(PACK_STATE, { pack: "education", source: "signup" });
    for (const sizeName of sizes) {
      const tag = `light-${sizeName}-en`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
      await page.goto(app("/students"), { waitUntil: "networkidle" });
      check((await page.getByRole("link", { name: "Send marks to parents" }).count()) >= 1, `${tag} students: no link to "Send marks to parents"`);
      await page.goto(app("/marks"), { waitUntil: "networkidle" });
      const text = await common(tag, "marks", page, errors, sizeName);
      has(tag, "marks", text, ["Send marks to parents", "Marks are not stored. The file is deleted after sending.", "Test mode: nothing is sent", "Nothing has been sent yet."]);
      await save(page, "marks-start", tag, "Send marks to parents: the note that marks are not stored, before any file");
      const csv = ["phone,student,subject,marks,out of,term", "9876543210,Asha,Maths,45,50,Term 1", "9876543211,Ravi,Maths,38,50,Term 1", "9876540000,Meera,Maths,40,50,Term 1", "9876549999,Kiran,Maths,41,50,Term 1", "98x,Bad,Maths,1,50,Term 1"].join("\n");
      await page.getByLabel("The file (CSV or Excel)").setInputFiles({ name: "marks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Show what will be sent" }).click();
      await page.locator('[data-part="marks-preview"]').waitFor({ timeout: 15000 });
      const pv = await page.locator('[data-part="marks-preview"]').innerText();
      has(tag, "marks preview", pv, ["Messages to send: 2", "Parents who will not get a message: 1", "this phone number is not a parent of this school", "the phone number is wrong", "Asha"]);
      await save(page, "marks-preview", tag, "Send marks to parents: counts, problems and the first message as the parent will read it");
      await page.getByRole("button", { name: "Send messages (2)" }).click();
      await page.locator('[data-part="marks-done"]').waitFor({ timeout: 15000 });
      has(tag, "marks done", await page.locator('[data-part="marks-done"]').innerText(), ["2 sent", "The file was not saved."]);
      await save(page, "marks-done", tag, "Send marks to parents: sent, and the file was not saved");
      await page.reload({ waitUntil: "networkidle" });
      check(/2 sent, 0 failed, 1 blocked/.test(await page.locator('[data-part="marks-log"]').innerText()), `${tag} marks: the log does not show the send`);
      check(!/Asha|Ravi|Maths|9876543210/.test(await page.locator("body").innerText()), `${tag} marks: a mark, a name or a number is on the page after the send`);
      check(errors.length === 0, `${tag} marks: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    Object.assign(PACK_STATE, { pack: "textiles", source: "legacy" });
    await stopWeb();

    // 4. a READ-ONLY workspace (the stand-in says so): one notice, every main button off, the person's own parts on, the way to pay again
    readOnly = true;
    await startWeb(FLAGS);
    for (const sizeName of sizes) {
      const tag = `light-${sizeName}-en`;
      const { context, page, errors } = await open({ scheme: "light", sizeName, lang: "en" });
      await page.goto(app("/quotes"), { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const text = await common(tag, "read-only quotes", page, errors, sizeName);
      has(tag, "read-only", text, ["This workspace is read-only", "billing@stack19.com", "Pay again and continue"]);
      check((await page.locator("[data-readonly-banner]").count()) === 1, `${tag} read-only: not one notice`);
      check((await page.locator('[data-dock="ask"]').count()) === 0, `${tag} read-only: the Ask dock is drawn`);
      const newQuote = page.getByRole("link", { name: /New quote/ });
      check((await newQuote.getAttribute("aria-disabled")) === "true", `${tag} read-only: "New quote" is not switched off`);
      check((await page.getByRole("link", { name: "Pay again and continue" }).getAttribute("aria-disabled")) === null, `${tag} read-only: the way to pay again is switched off`);
      await save(page, "read-only-quotes", tag, "a read-only workspace: the notice, 'New quote' off, the way to pay again", { fullPage: false });
      await page.goto(app("/"), { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const off = await page.locator("[data-readonly-off]").count();
      check(off >= 3, `${tag} read-only today: only ${off} controls are switched off`);
      check(await page.locator("#ask-input").isDisabled(), `${tag} read-only today: the question line is on`);
      await save(page, "read-only-today", tag, "a read-only Today: the cards' buttons and the question line are off", { fullPage: false });
      await page.goto(app("/settings?section=data"), { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      check((await page.locator("[data-readonly-off]").count()) === 0, `${tag} read-only data: a control of the Data part is switched off`);
      let offInSettings = 0;
      for (const part of ["members", "agent"]) {
        await page.goto(app(`/settings?section=${part}`), { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        offInSettings += await page.locator("[data-readonly-off]").count();
      }
      check(offInSettings >= 1, `${tag} read-only Settings (members, automation): nothing is switched off`);
      check(errors.filter((e) => !/404/.test(e)).length === 0, `${tag} read-only: console errors ${errors.join(" | ")}`);
      await context.close();
    }
    await stopWeb();
    readOnly = false;
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


