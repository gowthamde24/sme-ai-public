// The invented data of the visual tests (job BX): one business, one owner, a few customers and sarees. Nothing here is a real person or a real business. Every date is a fixed one (the browser clock is pinned to
// FIXED_NOW in run.mjs), so a picture never depends on the day it is taken.
export const TENANT = "11111111-1111-4111-8111-111111111111";
export const LEAD = "55555555-5555-4555-8555-555555555555";
// app v4 part 4: two synthetic phone calls (one live, one finished)
export const CALL_LIVE = "99999999-9999-4999-8999-0000000000c1";
export const CALL_DONE = "99999999-9999-4999-8999-0000000000c2";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const FIXED_NOW = "2026-10-14T05:00:00.000Z"; // Wednesday 14 October 2026, 10:30 in India

export const SESSION_USER = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "owner@visual.example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Visual Owner" },
  factors: [{ id: "33333333-3333-4333-8333-333333333333", friendly_name: "Authenticator", factor_type: "totp", status: "verified", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

import { defaultPackId, fieldsWire, modulesWire, packFiles, packsWire, packWire } from "./packs-wire.mjs";

const ok = (body) => body;
const T = `/v1/tenants/${TENANT}`;
const route = (suffix, answer) => [new RegExp(`^${T}${suffix}$`), answer];

// ---- Today -------------------------------------------------------------------------------------------------------------------------------
const MSG_PRICE = "66666666-6666-4666-8666-666666666601";
const CALL_ID = "66666666-6666-4666-8666-666666666602";
const QUOTE_ID = "66666666-6666-4666-8666-666666666603";
const ORDER_ID = "66666666-6666-4666-8666-666666666604";
const CONTACT = "77777777-7777-4777-8777-777777777701";
const AT = (h, m = 0) => `2026-10-14T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+00:00`;
const TODAY = {
  cards: { waiting: 4, money_held_paise: 40000, orders_open: 1 },
  needs_you: [
    { kind: "outbox_approval", id: MSG_PRICE, customer: "Anita Textiles", city: "Hyderabad", agent: "followup_desk", summary: "A WhatsApp message to a customer is waiting for your approval.", at: AT(4, 40), amount_paise: null, target: { type: "outbox_message", id: MSG_PRICE } },
    { kind: "quote_approval", id: QUOTE_ID, customer: "Lakshmi Silks", city: "Vijayawada", agent: "quote_writer", summary: "Quote 3 for ₹50,400.00 is ready for your approval.", at: AT(3, 20), amount_paise: 5040000, target: { type: "quote", id: QUOTE_ID } },
    { kind: "call_approval", id: CALL_ID, customer: "Meena Sarees", city: "Guntur", agent: "followup_desk", summary: "A request to phone a customer is waiting for your approval.", at: AT(2, 5), amount_paise: null, target: { type: "call_request", id: CALL_ID } },
    { kind: "order_money_held", id: ORDER_ID, customer: "Anita Textiles", city: "Hyderabad", agent: "order_desk", summary: "Order 1 is closed but still holds ₹400.00. A refund may be owed.", at: AT(1, 10), amount_paise: 40000, target: { type: "order", id: ORDER_ID } },
  ],
  recent: [
    { kind: "order_step", order_ref: "Order 2", customer: "Lakshmi Silks", text: "Order started", at: AT(3, 0), target: { type: "order", id: "66666666-6666-4666-8666-666666666605" } },
    { kind: "order_step", order_ref: "Order 1", customer: "Anita Textiles", text: "Order cancelled", at: "2026-10-13T04:00:00+00:00", target: { type: "order", id: ORDER_ID } },
  ],
};
const AGENTS = [
  { agent: "main", state: "not_available", job: "Coordinates the other helpers. Not built yet.", last_event: null },
  { agent: "lead_finder", state: "not_available", job: "Finds new businesses that may want to buy. Not built yet.", last_event: null },
  { agent: "researcher", state: "idle", job: "Reads public pages about a lead and writes down what it finds, with sources.", last_event: null },
  { agent: "requirement_analyst", state: "working", job: "Reads an enquiry and lists what the customer asked for, to be checked.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote from the prices you set. A person approves it.", last_event: { text: "Prepared quote 3", at: AT(3, 0) } },
  { agent: "followup_desk", state: "idle", job: "Drafts follow-up messages. A person approves and sends them.", last_event: { text: "Drafted follow-up message number 2", at: AT(4, 30) } },
  { agent: "order_desk", state: "idle", job: "Keeps each order's steps, payments and refunds in order.", last_event: { text: "Order started", at: AT(3, 0) } },
];

// ---- Visits ------------------------------------------------------------------------------------------------------------------------------
const VISIT_1 = "88888888-8888-4888-8888-888888888801";
const VISIT_2 = "88888888-8888-4888-8888-888888888802";
const VISIT_3 = "88888888-8888-4888-8888-888888888803";
const visit = (over) => ({
  id: VISIT_1, lead_id: LEAD, contact_id: CONTACT, customer: "Sri Lakshmi Silks", contact_name: "Priya S.", who: "Priya S.", city: "Hyderabad", date: "2026-10-14",
  starts_at: "2026-10-14T05:00:00Z", ends_at: "2026-10-14T05:30:00Z", party_size: 3, purpose: "Bridal sarees", note: null, status: "booked", source: "staff", outcome: null, order_id: null,
  advance_requested: false, advance_paise: null, confirmation_message_id: null, reminder_message_id: null, confirmation_sent: false, reminder_sent: false, cancel_reason: null,
  created_at: "2026-10-13T08:30:00Z", confirmed_at: null, arrived_at: null, closed_at: null, ...over,
});
const VISITS = [
  visit({ id: VISIT_1, status: "confirmed", confirmed_at: "2026-10-13T09:00:00Z", confirmation_sent: true }),
  visit({ id: VISIT_2, who: "Anita R.", contact_name: "Anita R.", customer: "Anita Textiles", party_size: 1, purpose: null, starts_at: "2026-10-14T06:30:00Z", ends_at: "2026-10-14T07:00:00Z", status: "booked", source: "assistant" }),
  visit({ id: VISIT_3, who: "Lakshmi Textiles", contact_name: null, customer: "Lakshmi Textiles", party_size: 2, purpose: "Silk saree wholesale", starts_at: "2026-10-14T04:30:00Z", ends_at: "2026-10-14T05:00:00Z", status: "completed", outcome: "will_return", arrived_at: "2026-10-14T04:35:00Z", closed_at: "2026-10-14T04:58:00Z" }),
];
const slots = (date) => {
  const list = [];
  for (let minute = 10 * 60; minute < 20 * 60 + 30; minute += 30) {
    const start = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const at = (m) => `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
    list.push({ start, starts_at: at(minute - 330), ends_at: at(minute - 300), capacity: 2, free: start === "11:00" ? 0 : 2, past: false });
  }
  return { date, open: true, reason: null, slot_minutes: 30, max_parallel: 2, slots: list };
};
const hours = { open: "10:00", close: "20:30" };

// ---- Outbox ------------------------------------------------------------------------------------------------------------------------------
const baseMsg = { lead_id: LEAD, contact_id: CONTACT, customer: "Anita Textiles", city: "Hyderabad", channel: "whatsapp", model_flagged: false, uncertain: false, disclosure_added: false, scheduled_for: null, edited_at: null, decided_at: null, sent_at: null, failure_code: null, media: [], gloss_en: null, events: null, flags: [] };
const MESSAGES = [
  { ...baseMsg, id: MSG_PRICE, text: "ఈ చీర ధర 500 రూపాయలు మాత్రమే.\n\nఈ సందేశం వ్యాపారం యొక్క AI సహాయకుడి నుండి వచ్చింది.", language: "te", category: "reply_to_inbound", source: "assistant", status: "needs_approval", reason: "money", reason_text: "It mentions money (a price, an amount, a discount, GST, an advance, a payment...). A person decides.", flags: ["money"], disclosure_added: true, gloss_en: "This saree costs only 500 rupees.", created_at: "2026-10-14T04:40:00Z" },
  { ...baseMsg, id: "66666666-6666-4666-8666-666666666611", text: "Yes, we have silk sarees in stock. We are open from 10 am to 8 pm.", language: "en", category: "reply_to_inbound", source: "assistant", status: "sent", reason: "auto_allowed", reason_text: "Allowed to go automatically.", scheduled_for: "2026-10-14T03:30:00Z", created_at: "2026-10-14T03:30:00Z", sent_at: "2026-10-14T03:31:02Z" },
  { ...baseMsg, id: "66666666-6666-4666-8666-666666666612", customer: "Meena Sarees", city: "Guntur", text: "Hello, would you like to see our new collection?", language: "en", category: "followup", source: "assistant", status: "blocked", reason: "no_opt_in", reason_text: "The customer has not agreed to WhatsApp messages and has never written to us.", created_at: "2026-10-13T12:30:00Z" },
];

// ---- Catalogue ---------------------------------------------------------------------------------------------------------------------------
// The pictures are GENERATED here (stand-in.mjs serves them): a draped-cloth pattern in the item's own colours, never a photograph of anything real.
export const STORAGE_URL = "https://127.0.0.1:54999";
const photo = (n) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0${n}`, position: 1, url: `${STORAGE_URL}/storage/v1/object/sign/catalogue/${n}.svg`, thumb_url: `${STORAGE_URL}/storage/v1/object/sign/catalogue/${n}.svg`, width: 600, height: 800, bytes: 20000, expires_in_seconds: 600 });
const item = (n, name, fabric, fabricLabel, colours, zari, band, bandLabel, stock, stockLabel, occasions, border) => ({
  id: `99999999-9999-4999-8999-9999999999${String(n).padStart(2, "0")}`, name, fabric, fabric_label: fabricLabel, colours, zari, border, occasions, price_band: band, price_band_label: bandLabel,
  price_paise: null, price_text: null, stock_status: stock, stock_label: stockLabel, active: true, photo_count: 1, created_at: "2026-10-01T05:00:00Z", updated_at: "2026-10-10T05:00:00Z", cover: photo(n),
});
const ITEMS = [
  item(1, "Red Kanchi pattu bridal", "kanchi_pattu", "Kanchi pattu", ["red", "gold"], "rich", "above_50k", "above ₹50,000", "in_stock", "In stock", ["wedding"], "Temple border"),
  item(2, "Peacock blue Mysore silk", "mysore_silk", "Mysore silk", ["blue"], "light", "10k_25k", "₹10,000 to ₹25,000", "few_left", "Few left", ["party", "festival"], "Peacock motif border"),
  item(3, "Blush pink Banarasi", "banarasi", "Banarasi", ["pink"], "none", "5k_10k", "₹5,000 to ₹10,000", "made_to_order", "Made to order", ["daily"], null),
  item(4, "Green Uppada", "uppada", "Uppada", ["green"], "light", "under_5k", "under ₹5,000", "in_stock", "In stock", ["festival"], null),
];

// ---- a lead -------------------------------------------------------------------------------------------------------------------------------
const COMPANY = "55555555-5555-4555-8555-555555555551";
const CALL_DONE_JSON = { id: CALL_DONE, direction: "inbound", state: "completed", live: false, who: "Meena Sarees", purpose: "inbound", language: "te", created_at: "2026-10-14T04:40:00Z", answered_at: "2026-10-14T04:40:04Z", ended_at: "2026-10-14T04:42:10Z", elapsed_s: 126, duration_s: 126, outcome: "positive", category: "visit_booked", summary_short: "Wants 20 Kanchi silk sarees for a wedding; visiting Saturday", refuse_reason: null, lead_id: LEAD, task_id: null, sandbox: true, simulated: false, ai_disclosed: true, recorded: false, cost_paise: 0, callback_at: null };
const CALL_LIVE_JSON = { ...CALL_DONE_JSON, id: CALL_LIVE, who: "Lakshmi", state: "in_progress", live: true, created_at: "2026-10-14T04:59:50Z", answered_at: "2026-10-14T04:59:56Z", ended_at: null, elapsed_s: 4, duration_s: null, outcome: null, category: null, summary_short: null };
const TALK = { greeting: { en: "Namaste! Thanks for calling {business}, I am the AI assistant." }, address: "plain", questions: ["What is the saree for?", "Which colours do you like?", "When do you need it?"], never_say: ["guaranteed", "best price in the market"], objections: [{ hears: "Too costly", answer: "We have sarees in many ranges; the team can show you options that fit." }], examples: [], say_like: [{ say: "pattu cheera", instead_of: "silk saree" }, { say: "Kanchi pattu", instead_of: null }] };
const ml = (n, name, city, area) => ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, company_id: null, contact_id: null, owner_user_id: null, status: "new", source: "indiamart", disqualified_reason: null, created_via: "import", created_at: "2026-10-12T05:00:00+00:00", updated_at: "2026-10-12T05:00:00+00:00", archived_at: null, is_new: false, display_name: name, profile: city ? { city, area, name } : { name } });
const MAP_LEADS = [ml(1, "Meena Sarees (made up)", "Guntur", "Brodipet"), ml(2, "Lakshmi Textiles (made up)", "Guntur", null), ml(3, "Ravi Kumar (made up)", "Vijayawada", "Benz Circle"), ml(4, "Anita Boutique (made up)", "Tenali", null), ml(5, "Kiran Silks (made up)", null, null)];
const FINDER_SEARCH = { id: "aaaaaaaa-0000-4000-8000-0000000000f1", state: "done", query: "saree shops", area: "Hyderabad", category_hint: "retailer", max_results: 20, provider: "fixture", sku: "fixture", est_cost_paise: 0, cost_paise: 0, cost_is_estimate: false, source_label: "Example search (made-up businesses) 'saree shops Hyderabad', 13 Oct", found: 35, counts: { found: 35, new: 35, duplicates: 0, call_ready: 1, needs_owner: 2, skipped: 32 }, searches_left_today: 4, attribution: null, created_at: "2026-10-13T05:00:00+00:00", approved_at: "2026-10-13T05:00:10+00:00", finished_at: "2026-10-13T05:00:20+00:00" };
const fp = (n, name, category, area, lat, lng, status, reason, fit, why) => ({ id: `bbbbbbbb-0000-4000-8000-00000000000${n}`, search_id: FINDER_SEARCH.id, name, category, area, phone: "+00 000 5123 4567", website: null, rating: 4.3, review_count: 120 + n * 31, lat, lng, source: "fixture", source_label: FINDER_SEARCH.source_label, attribution: null, status, decision_reason: reason, fit_score: fit, fit_reason: why, stock_match: { matched: ["Kanchi Pattu Bridal"], low: [], enough: true }, owner_approved: false, suppressed: false, ask_after: null, last_contacted_at: null, lead_id: null, qualification: null, created_at: "2026-10-13T05:00:20+00:00", updated_at: "2026-10-13T05:00:20+00:00" });
const FINDER_PROSPECTS = [
  fp(1, "Textile shop (made up)", "Saree shop", "Dilsukhnagar", 17.3688, 78.5247, "call_ready", "fit_high", 88, "Sells sarees, open today, well rated."),
  fp(2, "Boutique (made up)", "Boutique", "Kukatpally", 17.4948, 78.3996, "needs_owner", "first_calls", 71, "A bigger shop. Worth a word from you before the first call."),
  fp(3, "Saree retailer (made up)", "Saree shop", "Begum Bazar", 17.3745, 78.4764, "needs_owner", "fit_middle", 64, "Saree shop; some of what you stock."),
  fp(4, "Silk house (made up)", "Saree shop", "Secunderabad", 17.4399, 78.4983, "skipped", "contacted_recently", 80, "Contacted 40 days ago."),
  fp(5, "Wedding wear (made up)", "Boutique", "Banjara Hills", 17.4156, 78.4347, "skipped", "very_large", 55, "Very large shop."),
  fp(6, "Cloth stores (made up)", "Cloth store", "Charminar", 17.3616, 78.4747, "skipped", "fit_low", 38, "Poor fit for what you stock."),
];
const LEAD_JSON = { id: LEAD, company_id: COMPANY, contact_id: CONTACT, status: "in_review", source: "csv import", created_via: "import", created_at: "2026-10-02T05:00:00+00:00", display_name: "Meena Sarees", profile: { need: "Kanchi silk sarees for a wedding", quantity: "20 pieces", budget: "₹2,000 to ₹2,500 each", area: "Brodipet", city: "Guntur", language: "te", source: "indiamart" } };
const COMPANY_JSON = { id: COMPANY, name: "Sri Lakshmi Silks", type: "customer", website: "https://sri-lakshmi.example.test", country: "India", city: "Hyderabad", industry: "Textiles", created_via: "manual", created_at: "2026-10-01T05:00:00+00:00" };

// ---- the business type of the workspace (job CL, on top of job CK) --------------------------------------------------------------------------------
// The workspace runs the DEFAULT business type, as a workspace that existed before business types does (`source: "legacy"`): the pictures of every older screen stay exactly as they were. The pack pictures
// (e2e/cl-shots.mjs) set `pack` to another business type's id and `source: "signup"`; `example` ("none" | "loaded") says whether the sample is loaded, `town` is the business profile's city, `providers` which
// sign-up buttons the server offers, `ownerFields` fields an owner added. The words, modules and fields are the real files of packages/packs through the API's shapes (packs-wire.mjs).
export const PACK_STATE = { pack: defaultPackId(), source: "legacy", modules: null, example: "none", town: null, providers: { google: false, facebook: false }, level: "aal2", ownerFields: [] };
/** Paths the API answers without a sign-in (the stand-in does not ask for a token here). */
export const PUBLIC_API_PATHS = new Set(["/v1/packs", "/v1/auth/providers", "/v1/policies/current"]);
const COUNTS_NONE = { companies: 0, contacts: 0, leads: 0, products: 0 };
const exampleStatus = () => (PACK_STATE.example === "loaded"
  ? { loaded: true, batch_id: "99999999-9999-4999-8999-999999999901", pack_id: PACK_STATE.pack, loaded_at: "2026-10-14T04:00:00Z", removed_at: null, counts: { companies: 2, contacts: 3, leads: 3, products: 4 } }
  : { loaded: false, batch_id: null, pack_id: null, loaded_at: null, removed_at: null, counts: COUNTS_NONE });
const customFields = (url) => {
  const entity = url.searchParams.get("entity");
  return { fields: [...fieldsWire(PACK_STATE.pack).fields, ...PACK_STATE.ownerFields].filter((f) => !entity || f.entity === entity) };
};

// ---- the route table ---------------------------------------------------------------------------------------------------------------------
export const API_ROUTES = [
  [/^\/v1\/me$/, ok({ user_id: USER_ID, memberships: [{ role: "owner", tenant: { id: TENANT, name: "Sri Visual Silks", slug: "sri-visual-silks" } }] })],
  [new RegExp(`^/v1/tenants/${TENANT}$`), ok({ id: TENANT, name: "Sri Visual Silks", slug: "sri-visual-silks", role: "owner", plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-09-20T00:00:00Z" })],
  [/^\/v1\/packs$/, () => packsWire()],
  [/^\/v1\/auth\/providers$/, () => ({ email: true, ...PACK_STATE.providers })],
  [/^\/v1\/policies\/current$/, ok({ terms: { version: "2026-10", effective_from: "2026-10-01" }, privacy: { version: "2026-10", effective_from: "2026-10-01" } })],
  [/^\/v1\/account\/security$/, () => ({ session_level: PACK_STATE.level, asked_at_sign_up: false, needed_for: ["approvals", "whatsapp_connect", "rules_and_prices", "imports_and_exports", "team_and_privacy"] })],
  route("/pack", () => packWire(PACK_STATE.pack, PACK_STATE.source)),
  route("/modules", () => modulesWire(PACK_STATE.modules ?? packFiles()[PACK_STATE.pack].modules)),
  route("/example-data", () => exampleStatus()),
  route("/custom-fields", ({ url }) => customFields(url)),
  route("/contacts/[0-9a-f-]{36}/custom", ({ match }) => ({ entity: "contact", entity_id: match[0].split("/")[5], values: [] })),
  route("/catalogue/[0-9a-f-]{36}/custom", ({ match }) => ({ entity: "catalogue_item", entity_id: match[0].split("/")[5], values: [] })),
  route("/profile", () => ({ name: "Sri Visual Silks", town: PACK_STATE.town, languages: ["en"], setup_complete: PACK_STATE.town !== null })),
  route("/today", TODAY),
  // sidebar v2: the menu's numbers (C1's contract docs/contracts/nav-counts.md); the same counts as the invented Today and visits above where there is one
  route("/nav-counts", { needs_you: 4, prospects_needing_owner: null, new_leads: 3, live_calls: 0, unread_chats: 2, followups_due: 5, visits_today: 2, quotes_waiting: 1, ai_team_working: 2, call_minutes: { used: 412, total: 600 }, ai_usage: { used_paise: 6800, allowance_paise: 30000, period: "month" }, plan: "free_trial", as_of: "2026-10-14T05:00:00Z" }),
  route("/agents/status", AGENTS),
  route("/ai-usage", { today_percent: 12, month_percent: 31, resets_at_today: "2026-10-14T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }),
  // job DP: the workspace's layout asks whether it is read-only; the pictures are of a workspace that pays
  route("/billing/access", { access: "full", read_only_since: null, delete_on: null, data_days_left: null, can_resume: false, sending: "on", waiting_for: null }),
  route("/ai-usage/week", { week_percent: 18, resets_at_week: "2026-10-18T18:30:00Z" }),
  // job CU: the Settings page also reads the business profile (the GSTIN card)
  route("/business-profile", { gstin: null, state: null }),
  route("/members", { members: [{ user_id: USER_ID, role: "owner", display_name: "Visual Owner" }, { user_id: "22222222-2222-4222-8222-222222222299", role: "sales", display_name: "Ravi Kumar" }] }),
  route("/team", { members: [{ user_id: USER_ID, role: "owner", display_name: "Visual Owner", joined_at: "2026-09-01T05:00:00Z", is_you: true }, { user_id: "22222222-2222-4222-8222-222222222299", role: "admin", display_name: "Ravi Kumar", joined_at: "2026-09-12T05:00:00Z", is_you: false }, { user_id: "22222222-2222-4222-8222-222222222298", role: "sales", display_name: "Meena Rao", joined_at: "2026-09-20T05:00:00Z", is_you: false }, { user_id: "22222222-2222-4222-8222-222222222297", role: "viewer", display_name: "Sunil Verma", joined_at: "2026-10-02T05:00:00Z", is_you: false }], pending_invitations: 0 }), // the team page (e2e/cj-shots.mjs)
  route("/invitations", { invitations: [] }), // the team page (e2e/cj-shots.mjs); no invitation is waiting
  route("/outbox/settings", { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }),
  route("/outbox/summary", { waiting: 1, scheduled: 0, sent: 1, blocked: 1, due_now: 0, held_for_later: 0 }),
  route("/outbox/messages", ({ url }) => {
    const tab = url.searchParams.get("tab");
    const by = { waiting: "needs_approval", sent: "sent", blocked: "blocked", scheduled: "queued" };
    const items = tab ? MESSAGES.filter((m) => m.status === by[tab]) : MESSAGES;
    return { items, next_cursor: null };
  }),
  route("/visits/today", { date: "2026-10-14", items: [
    { id: VISIT_1, lead_id: LEAD, starts_at: "2026-10-14T05:00:00Z", who: "Priya S.", extra: 2, topic: "Bridal sarees", status: "confirmed", visit_status: "confirmed" },
    { id: VISIT_2, lead_id: LEAD, starts_at: "2026-10-14T06:30:00Z", who: "Anita R.", extra: 0, topic: null, status: "requested", visit_status: "booked" },
  ] }),
  route("/visits/slots", ({ url }) => slots(url.searchParams.get("date") || "2026-10-14")),
  route("/visits/settings", { weekly_hours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null }, closed_dates: ["2026-10-20"], slot_minutes: 30, max_parallel: 2, is_default: false }),
  route("/visits", ({ url }) => {
    const status = url.searchParams.get("status");
    const items = status ? VISITS.filter((v) => v.status === status) : VISITS;
    return { from: url.searchParams.get("from") || "2026-10-14", to: url.searchParams.get("to") || "2026-10-14", items };
  }),
  route("/scheduler/status", { platform_switch_on: true, auto_send_enabled: false, active: false, releases_approved: true, worker_running: true, last_run_at: "2026-10-14T04:58:00Z", next_run_at: "2026-10-14T04:59:00Z", interval_seconds: 60, last_activity_at: "2026-10-14T03:30:00Z", today: { sent: 2, failed: 0, reminders: 1, no_shows: 0, errors: 0 } }),
  route("/scheduler/settings", { reminder_evening_enabled: true, reminder_evening_hour: 18, reminder_heads_up_enabled: true, reminder_heads_up_minutes: 120, no_show_enabled: false, no_show_after_minutes: 30, is_default: true }),
  route("/outbox/approvals", { items: [MESSAGES[0]], next_cursor: null }),
  route("/call-requests", { items: [{ id: CALL_ID, lead_id: LEAD, contact_id: CONTACT, customer: "Meena Sarees", city: "Guntur", reason: "The customer asked for a call about a large wedding order.", script_draft: "Hello, this is Sri Visual Silks. How many pieces do you need?", language: "en", status: "requested", created_at: "2026-10-14T02:05:00Z", decided_at: null, decision_note: null }], next_cursor: null }),
  route("/quotes", [{ id: QUOTE_ID, quote_no: 3, enquiry_id: "66666666-6666-4666-8666-666666666606", status: "draft", outcome: "draft", customer_kind: "new", valid_until: "2026-10-29", total_paise: 5040000, needs_owner_approval: false, created_at: "2026-10-14T03:20:00+00:00", customer: "Lakshmi Silks", city: "Vijayawada" }]),
  route(`/leads/${LEAD}`, LEAD_JSON),
  route(`/companies/${COMPANY}`, COMPANY_JSON),
  route(`/leads/${LEAD}/evidence`, { items: [
    { id: "77777777-0000-4000-8000-000000000001", evidence: { kind: "web_page", provider: "company website", url: "https://sri-lakshmi.example.test/about", reference: null, snippet: "Family wholesale silk sarees since 1962.", retrieved_at: "2026-10-02T05:00:00+00:00", published_at: null, created_via: "manual" } },
    { id: "77777777-0000-4000-8000-000000000002", evidence: { kind: "note", provider: "owner note", url: null, reference: "called on Monday", snippet: "Asked for 20 pieces before the festival.", retrieved_at: "2026-10-03T05:00:00+00:00", published_at: null, created_via: "manual" } },
  ], next_cursor: null }),
  route(`/leads/${LEAD}/enquiries`, []),
  // app v4 part 6: Sales > Money and low stock (made-up customers)
  route("/money/summary", { as_of: "2026-10-14", owed_paise: 17500000, overdue_paise: 5000000, customers_owing: 2, customers_overdue: 1, paid_this_month_paise: 7000000, month_from: "2026-10-01", top: [{ account_id: "adadadad-adad-4dad-8dad-adadadadada1", company_id: COMPANY, contact_id: CONTACT, name: "Sri Rama Builders (made up)", outstanding_paise: 13000000, overdue_paise: 5000000 }, { account_id: "adadadad-adad-4dad-8dad-adadadadada2", company_id: "11111111-1111-4111-8111-111111111112", contact_id: null, name: "Lakshmi Hardware (made up)", outstanding_paise: 4500000, overdue_paise: 0 }], complete: true }),
  route("/catalogue/low-stock", { items: [{ id: ITEMS[0].id, name: ITEMS[0].name, stock_status: "in_stock", quantity: 2, asked_this_week: 3, asked_is_approximate: true }, { id: ITEMS[1].id, name: ITEMS[1].name, stock_status: "few_left", quantity: null, asked_this_week: 0, asked_is_approximate: true }], counts_available: true }),
  // app v4 part 5: Customers > Map (made-up customers with a place, and one site; needs LEADS_SCREENS=1 for the run)
  route("/leads", { items: MAP_LEADS, next_cursor: null }),
  route("/sites", { items: [{ id: "cccccccc-0000-4000-8000-0000000000c1", company_id: COMPANY, name: "Lake Road site (made up)", address_line: "12 Lake Road", city: "Guntur", pin: "522001", map_lat: null, map_lng: null, distance_km: null, lane_width_ft: null, night_delivery: false, unloading_help: false, access_notes: null, site_contact_id: null, active: true, created_at: "2026-10-02T05:00:00+00:00", updated_at: "2026-10-02T05:00:00+00:00" }], next_cursor: null }),
  // app v4 part 5: the Lead Finder (made-up businesses around Hyderabad)
  route("/lead-finder/availability", { available: true, source: "fixture", reason: "ok", upgrade_to: null, audience: "businesses" }),
  route("/lead-finder/searches", { items: [FINDER_SEARCH] }),
  route("/prospects/stats", { total: 35, by_status: { call_ready: 1, needs_owner: 2, skipped: 32 } }),
  route("/prospects", { items: FINDER_PROSPECTS, next_cursor: null }),
  // app v4 part 4: the phone calls (synthetic): one live, one finished, one refused
  route("/calls", { items: [CALL_LIVE_JSON, CALL_DONE_JSON, { ...CALL_DONE_JSON, id: "99999999-9999-4999-8999-0000000000c3", who: "Anita Textiles", lead_id: null, state: "refused", refuse_reason: "outside_hours", outcome: null, category: null, summary_short: null, elapsed_s: 0, created_at: "2026-10-13T16:10:00Z" }], next_cursor: null, updated_at: "2026-10-14T05:00:00Z", poll_after_s: 5 }),
  route(`/calls/${CALL_LIVE}`, { ...CALL_LIVE_JSON, summary: null, end_reason: null, captured: { occasion: "Wedding", saree: "Kanchi silk", budget: "up to 15,000" }, transcript: [
    { who: "assistant", text: "Hello! I am the AI assistant of Sri Visual Silks. You asked about silk sarees, right?", t: 1, text_en: null },
    { who: "caller", text: "అవును, పెళ్లి కోసం కంచి పట్టు చీర కావాలి. బడ్జెట్ పదిహేను వేల వరకు.", t: 4, text_en: "Yes, I need a Kanchi silk saree for a wedding. Budget up to fifteen thousand." },
  ], correction: null }),
  route(`/calls/${CALL_DONE}`, { ...CALL_DONE_JSON, summary: "Meena wants 20 Kanchi silk sarees for a wedding on 2 November and will visit the store on Saturday.", end_reason: "goodbye", captured: { saree: "Kanchi silk", quantity: "20 pieces", visit_day: "Saturday" }, transcript: [
    { who: "assistant", text: "Namaste! I am the AI assistant of Sri Visual Silks. How can I help?", t: 1 },
    { who: "caller", text: "I need 20 Kanchi silk sarees for a wedding.", t: 5 },
    { who: "assistant", text: "Lovely. Would you like to see them at the store? We are open on Saturday.", t: 11 },
    { who: "caller", text: "Yes, Saturday works.", t: 16 },
  ], correction: { summary: null, captured: {}, note: "Kanchi pattu means Kanchipuram silk", corrected_at: "2026-10-14T06:00:00Z" } }),
  route("/talk-training", { training: TALK, saved: true, defaults: TALK, rules: ["Always says it is an AI.", "Never states a price; the team gives prices."], updated_at: "2026-10-13T05:00:00Z", wording: "draft" }),
  // app v4 part 3: one customer's timeline (synthetic), newest first
  route(`/customers/${LEAD}/timeline`, { items: [
    { kind: "call", at: "2026-10-14T04:40:00Z", text: "Wants 20 Kanchi silk sarees for a wedding; will visit the store on Saturday", target: { type: "phone_call", id: "c1" }, detail: { direction: "inbound", duration_s: 126, outcome: "positive" } },
    { kind: "visit", at: "2026-10-13T09:00:00Z", text: "See the wedding collection", target: { type: "visit", id: "v1" }, detail: { status: "booked" } },
    { kind: "quote", at: "2026-10-13T05:20:00Z", text: "Quote 3", target: { type: "quote", id: QUOTE_ID }, detail: { status: "draft", total_paise: 5040000 } },
    { kind: "order", at: "2026-10-12T09:00:00Z", text: "Order 2", target: { type: "order", id: "66666666-6666-4666-8666-666666666699" }, detail: { state: "advance_paid", total_paise: 12000000 } },
    { kind: "message_out", at: "2026-10-12T06:00:00Z", text: "Hello, here are the photos of the Kanchi silk sarees you asked about.", target: { type: "outbox_message", id: "m1" }, detail: { channel: "whatsapp", status: "sent" } },
    { kind: "message_in", at: "2026-10-12T05:30:00Z", text: "Price for 20 pieces please, wedding on 2 November", target: { type: "enquiry", id: "e1" }, detail: { channel: "whatsapp" } },
    { kind: "arrival", at: "2026-10-12T05:28:00Z", text: "IndiaMART", target: { type: "lead", id: LEAD }, detail: { source: "indiamart", how: "first" } },
  ], next_before: null }),
  route(`/leads/${LEAD}/claims`, [
    { id: "88888888-0000-4000-8000-000000000001", company_id: COMPANY, lead_id: null, predicate: "buyer_type", value: "wholesale", confidence: "medium", claim_confidence: "medium", created_via: "agent", agent_run_id: "99999999-0000-4000-8000-000000000001", created_by: null, created_at: "2026-10-04T05:00:00+00:00", review_state: "unreviewed", review_confidence: null, reviewed_by: null, reviewed_at: null, counts_toward_score: false, company_name: "Sri Lakshmi Silks", evidence: [{ kind: "web_page", stance: "supports", provider: "company website", host: "sri-lakshmi.example.test", path: "/about", quote: "Family wholesale silk sarees since 1962." }] },
  ]),
  route("/catalogue/items", { items: ITEMS, next_cursor: null }),
];
