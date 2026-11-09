// The visual tests' invented backend with the three business types the owner named (sarees, building materials, a school), shared by shell-shots.mjs (the pictures) and nav-walk.mjs (every menu item opens its own page).
// No database, no keys, no network after the build, no real person. Same ports as run.mjs (54999, 3014); it stops only its own processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, PACK_STATE, SESSION_USER, TENANT, USER_ID } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
export const STAND_IN_PORT = 54999;
export const WEB_PORT = 3014;
export const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export { TENANT };

// the three business types and an invented name for each (the stand-in's own business is "Sri Visual Silks")
export const PACKS = [
  { id: "textiles", short: "sarees", name: "Lakshmi Silks (example)", finder: true },
  { id: "construction_materials", short: "cements", name: "Sri Sai Cements (example)", finder: true },
  { id: "education", short: "school", name: "Vidya Public School (example)", finder: false },
];
let current = PACKS[0];
/** Which business type the stand-in plays from now on. */
export function usePack(p) {
  current = p;
  PACK_STATE.pack = p.id;
  PACK_STATE.source = "signup";
}

const json = (body) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(typeof body === "function" ? body() : body));
};
const T = `/v1/tenants/${TENANT}`;
// the assistant is on (the stand-in's own list says "not built yet"), so Today draws its composer and chips
const AGENTS_ON = [
  { agent: "main", state: "idle", job: "Answers and does what you ask.", last_event: null },
  { agent: "lead_finder", state: "idle", job: "Finds new businesses that may want to buy.", last_event: { text: "Found 18 boutiques; 3 need your OK", at: "2026-10-14T04:10:00Z" } },
  { agent: "researcher", state: "working", job: "Reads public pages about a lead.", last_event: { text: "Reading 2 new IndiaMART enquiries", at: "2026-10-14T04:55:00Z" } },
  { agent: "requirement_analyst", state: "idle", job: "Reads an enquiry.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote.", last_event: { text: "Prepared quote 3", at: "2026-10-14T02:00:00Z" } },
  { agent: "followup_desk", state: "working", job: "Drafts follow-ups.", last_event: { text: "5 due today, next at 16:00", at: "2026-10-14T04:30:00Z" } },
  { agent: "order_desk", state: "switched_off", job: "Keeps orders in order.", last_event: null },
];
// a SCHOOL's own Today (owner's review, 5 Nov: never another business type's rows or cards): two things that wait (a fee reminder plan to approve, a follow-up to an admission enquiry), today's fee report, a reminder
// campaign running, admissions at each stage. Invented names; the stand-in's own Today is a saree shop's and is never shown for the school.
const SCHOOL_TODAY = {
  cards: { waiting: 2, money_held_paise: 0, orders_open: 0 },
  needs_you: [
    { kind: "campaign_approval", id: "ca000000-0000-4000-8000-000000000001", customer: "October fee reminders", city: null, agent: "followup_desk", summary: "A fee reminder plan for 18 parents is waiting for your approval.", at: "2026-10-14T04:20:00Z", amount_paise: 41250000, target: { type: "campaign", id: "ca000000-0000-4000-8000-000000000001" } },
    { kind: "followup_due", id: "f0000000-0000-4000-8000-000000000001", customer: "Lakshmi Devi (parent)", city: "Anantapur", agent: "followup_desk", summary: "A follow-up message (number 1) is drafted and waiting for your approval.", at: "2026-10-14T03:40:00Z", amount_paise: null, target: { type: "lead", id: "1ead0000-0000-4000-8000-000000000001" } },
  ],
  recent: [],
};
const SCHOOL_REPORT = { report: "education.today", as_of: "2026-10-14", from: "2026-10-14", to: "2026-10-14", kpis: [{ key: "collected_paise", value: 3700000, unit: "paise" }, { key: "receipts", value: 4, unit: "count" }], tables: [], series: [] };
const CAMPAIGN = {
  id: "ca000000-0000-4000-8000-000000000002", name: "October fee reminders", kind: "fee_due", status: "running", language: "en", wa_template_id: "7e000000-0000-4000-8000-000000000001",
  message_text: "Hello {{name}}, the fee of {{amount}} for {{reference}} is due on {{due_date}}. {{business}}", steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }],
  call_after_step: 2, call_wait_hours: 24, audience_kind: "filter", audience_filter: { due_from: "2026-10-01", due_to: "2026-10-31" }, approved_by: "11111111-1111-4111-8111-111111111111", approved_at: "2026-10-12T06:00:00+00:00", approved_recipients: 18, approved_total_paise: 41250000,
  created_at: "2026-10-10T05:00:00+00:00", updated_at: "2026-10-12T05:00:00+00:00", paused_at: null, cancelled_at: null, completed_at: null, recipients: 18, total_amount_paise: 41250000,
};
const admission = (n, name, stage) => ({ id: `ad000000-0000-4000-8000-00000000000${n}`, lead_id: `1ead0000-0000-4000-8000-00000000000${n}`, contact_id: `c0000000-0000-4000-8000-00000000000${n}`, contact_name: name, programme_id: "b0000000-0000-4000-8000-000000000001", programme_name: "Class 1", source: "whatsapp", stage, lost_reason: null, student_id: null, stage_at: "2026-10-10T05:00:00+00:00", created_at: "2026-10-08T05:00:00+00:00", visits: 0, next_visit: null });
const ADMISSIONS = { items: [admission(1, "Lakshmi Devi (parent)", "enquiry"), admission(2, "Ravi Kumar (parent)", "campus_visit"), admission(3, "Suresh Babu (parent)", "application"), admission(4, "Meena (parent)", "admitted")], next_cursor: null };
const school = () => current.id === "education";
// the app's own fixtures (lib/api/*-fixtures.ts: self-contained, the unit tests' data), read through jiti, for the pages the stand-in's own list does not cover (every menu item opens its page with data: nav-walk.mjs)
const jiti = createRequire(path.join(WEB_DIR, "package.json"))("jiti").createJiti(import.meta.url);
const fx = (name) => jiti(path.join(WEB_DIR, "lib", "api", `${name}-fixtures.ts`));
const ORDERS = fx("orders");
const FOLLOWUPS = fx("followups");
const TRIPS = fx("deliveries");
const LEDGER = fx("ledger");
const REPORTS = fx("reports");
const MATERIALS = fx("materials");
const EDU = fx("education");
const extraRoutes = [
  // C1's records search (docs/contracts/search.md), for the ⌘K palette: one lead of the stand-in's own, when its name is typed
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/search$`), (req, res) => {
    const q = new URL(req.url, "https://x").searchParams.get("q") ?? "";
    const hit = /anjali/i.test(q);
    return json({ groups: hit ? [{ kind: "lead", items: [{ id: "55555555-5555-4555-8555-555555555555", title: "Anjali Boutique (example)", sub: "Hyderabad" }] }] : [] })(req, res);
  }],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/orders$`), json(() => ({ items: [ORDERS.ORDER_JSON], next_cursor: null }))],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/followups/due$`), json(() => FOLLOWUPS.DUE_LIST_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/trips$`), json(() => TRIPS.TRIP_LIST_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/ledger/summary$`), json(() => LEDGER.SUMMARY_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/reports/catalogue$`), json(() => (current.id === "education" ? REPORTS.CATALOGUE_EDUCATION_JSON : current.id === "construction_materials" ? REPORTS.CATALOGUE_CONSTRUCTION_JSON : REPORTS.CATALOGUE_WEEKLY_JSON))],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/materials/items$`), json(() => MATERIALS.LIST_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/materials/policy$`), json(() => MATERIALS.POLICY_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/materials/quotes$`), json(() => MATERIALS.QUOTE_LIST_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/institution/programmes$`), json(() => EDU.PROGRAMMES_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/institution/profile$`), json(() => EDU.PROFILE_JSON)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/today$`), (req, res) => (school() ? json(SCHOOL_TODAY)(req, res) : false)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/reports/run/education\\.today$`), json(SCHOOL_REPORT)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/campaigns$`), json({ items: [CAMPAIGN], next_cursor: null })],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/institution/admissions$`), json(ADMISSIONS)],
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/status$`), json(() => AGENTS_ON)],
  // C1's switches (docs/contracts/agents-switches.md): the assistant and the researcher switchable (it is the one working), the requirement reader locked by the platform, the features without a switch of their own
  ["GET", new RegExp(`^/v1/tenants/${TENANT}/agents/switches$`), json(() => [
    { agent: "main", enabled: true, can_switch: true, reason_locked: null, done_today: 12 },
    { agent: "researcher", enabled: true, can_switch: true, reason_locked: null, done_today: 3 },
    { agent: "requirement_analyst", enabled: true, can_switch: false, reason_locked: "platform", done_today: 0 },
    ...["lead_finder", "quote_writer", "followup_desk", "order_desk"].map((agent) => ({ agent, enabled: true, can_switch: false, reason_locked: "not_built", done_today: null })),
  ])],
  ["GET", /^\/v1\/me$/, json(() => ({ user_id: USER_ID, memberships: [{ role: "owner", tenant: { id: TENANT, name: current.name, slug: "example" } }] }))],
  ["GET", new RegExp(`^${T}$`), json(() => ({ id: TENANT, name: current.name, slug: "example", role: "owner", plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-09-20T00:00:00Z" }))],
  ["GET", new RegExp(`^${T}/lead-finder/availability$`), json(() => (current.finder ? { available: true, source: "fixture", reason: "ok", upgrade_to: null, audience: "businesses" } : { available: false, source: null, reason: "not_for_this_business", upgrade_to: null, audience: "organisations" }))],
  // "How I talk to customers" (C1's talk-training): the suggested document for a saree shop
  ["GET", new RegExp(`^${T}/talk-training$`), json(() => {
    const doc = { greeting: { en: "Namaste! Thanks for calling {business}, I am the AI assistant. How can I help?" }, address: "plain", questions: ["What is it for?", "When do you need it?"], never_say: ["guaranteed"], objections: [], examples: [] };
    return { training: doc, saved: false, defaults: doc, rules: ["Says it is an AI at the start and whenever asked."], updated_at: null, wording: "draft" };
  })],
  ["GET", new RegExp(`^${T}/nav-counts$`), json(() => ({ needs_you: school() ? 3 : 5, prospects_needing_owner: current.finder ? 0 : null, new_leads: 12, live_calls: 1, unread_chats: 2, followups_due: 5, visits_today: 2, quotes_waiting: current.id === "education" ? null : 1, ai_team_working: 4, call_minutes: { used: 412, total: 600 }, ai_usage: { used_paise: 6800, allowance_paise: 30000, period: "month" }, plan: "ai_workforce", as_of: "2026-10-14T05:00:00Z" }))],
];

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
export function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER }))}`;
}
export const connect = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
async function waitForPort(port, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await connect(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}


/** The screens' flags as staging has them (deploy env, 6 Nov), "mock" where the invented backend has no data for that part: the menu then offers what staging offers. */
export const STAGING_FLAGS = { LEADS_SCREENS: "mock", OUTREACH_SCREENS: "mock", TASK_SCREENS: "mock", SOURCE_CARDS_SCREENS: "mock", TALK_TRAINING_SCREENS: "1", ASSISTANT_SCREENS: "mock", OPENING_LINE_SCREENS: "mock" };

/** Builds the web app against the stand-in (unless `build` is false), starts both, and answers `{ standIn, close }`. */
export async function startApp({ build = true, log = "app", env = {} } = {}) {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "shell-env-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (build) {
    console.log(`${log}: building the web app against the stand-in`);
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    // BROWSER_VOICE (read by the server at request time): Today draws the assistant's composer with the orb, as staging does
    env: { ...process.env, ...webEnv, ...env, BROWSER_VOICE: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    // SHOTS_DEBUG=1: the web server's own output on this terminal (a page that does not finish loading)
    stdio: process.env.SHOTS_DEBUG ? ["ignore", "inherit", "inherit"] : ["ignore", "ignore", "ignore"],
  });
  await waitForPort(WEB_PORT);
  const close = async () => {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  return { standIn, close };
}
