import { notYetFileJson } from "./files";

/**
 * Synthetic answers for the assistant's work cards and Settings > Activity, in the API's wire shape (C1's contract, docs/contracts/assistant-tools.md, field for field), so every fixture goes through
 * the real parser. Used by the tests, the screen snapshot, the fixture-only preview page and the "mock" mode of ASSISTANT_WORK_SCREENS. Every name, number and key is made up.
 */
export const TENANT_BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";

export const PLAN_IMPORT_ID = "a1000000-0000-4000-8000-000000000001";
export const PLAN_HOURS_ID = "a1000000-0000-4000-8000-000000000002";
export const PLAN_STAFF_ID = "a1000000-0000-4000-8000-000000000003";
export const PLAN_MULTI_ID = "a1000000-0000-4000-8000-000000000004";
export const PREVIEW_ID = "b1000000-0000-4000-8000-000000000001";
export const PREVIEW_CAT_ID = "b1000000-0000-4000-8000-000000000002";
export const KEY_CARD_ID = "c1000000-0000-4000-8000-000000000001";
export const SETUP_INDIAMART_ID = "d1000000-0000-4000-8000-000000000001";
export const SETUP_EMAIL_ID = "d1000000-0000-4000-8000-000000000002";
export const SETUP_FORM_ID = "d1000000-0000-4000-8000-000000000003";
export const SETUP_HOURS_ID = "d1000000-0000-4000-8000-000000000004";
export const CANT_ID = "e1000000-0000-4000-8000-000000000001";
export const PLAN_CARD_ID = "a2000000-0000-4000-8000-000000000001";
export const KEY_ASK_ID = "c2000000-0000-4000-8000-000000000001";
const EXPIRES = "2026-11-04T10:30:00Z"; // 30 minutes after the fixtures' clock (FIXTURE_NOW)

export const IMPORT_PLAN_JSON = {
  plan_id: PLAN_IMPORT_ID,
  title: "Add 31 new leads from leads-guntur-nov.xlsx",
  steps: [
    { tool: "lead-imports.commit", summary: "Add 31 new leads (4 are already in Leads and are left as they are; 2 have no phone; 1 looks like a supplier and is left out)", undoable: true, status: "proposed", error: null },
    { tool: "leads.tag", summary: "Tag them “wedding season”", undoable: true, status: "proposed", error: null },
  ],
  status: "proposed",
  sensitive: null,
  owner_only: false,
  needs_second_factor: false,
  expires_at: EXPIRES,
};

export const PREVIEW_JSON = {
  kind: "file_preview",
  id: PREVIEW_ID,
  file_name: "leads-guntur-nov.xlsx",
  destination: "leads",
  customer_name: null,
  facts: [{ code: "found", n: 38 }, { code: "existing", n: 4 }, { code: "no_phone", n: 2 }, { code: "supplier", n: 1 }],
  columns: ["Name", "Phone", "Town", "Wants"],
  rows: [
    ["Lakshmi Prasanna", "+00 000 000 6701", "Guntur", "Kanchi pattu, 40 sarees"],
    ["Venkata Ramana Rao", "+00 000 000 6702", "Tenali", "Wedding set"],
    ["Sravani Reddy", "", "Narasaraopet", "Gadwal silk"],
  ],
  plan: IMPORT_PLAN_JSON,
};

export const CATALOGUE_PREVIEW_JSON = {
  kind: "file_preview",
  id: PREVIEW_CAT_ID,
  file_name: "price-list-nov.xlsx",
  destination: "catalogue",
  customer_name: null,
  facts: [{ code: "found", n: 24 }, { code: "existing", n: 18 }, { code: "no_price", n: 2 }],
  columns: ["Item", "Price", "Stock"],
  rows: [
    ["Mysore silk, plain border", "₹ 6,800", "12"],
    ["Ilkal cotton", "₹ 1,450", "40"],
  ],
  plan: {
    plan_id: "a1000000-0000-4000-8000-000000000005",
    title: "Update 18 prices and add 6 new items",
    steps: [{ tool: "catalogue.update_prices", summary: "Change the price of 18 items (each old price is kept, so this can be undone)", undoable: true, status: "proposed", error: null }, { tool: "catalogue.add_items", summary: "Add 6 new items (2 have no price and are added as hidden)", undoable: true, status: "proposed", error: null }],
    status: "proposed",
    sensitive: "money",
    owner_only: true,
    needs_second_factor: false,
    expires_at: EXPIRES,
  },
};

export const HOURS_PLAN_JSON = {
  plan_id: PLAN_HOURS_ID,
  title: "Change calling hours to 10 am – 7 pm",
  steps: [{ tool: "calls.set_hours", summary: "Calling hours: 10:00 am to 7:00 pm, Monday to Saturday (now 9:30 am to 8:00 pm)", undoable: true, status: "proposed", error: null }],
  status: "proposed",
  sensitive: null,
  owner_only: true,
  needs_second_factor: false,
  expires_at: EXPIRES,
};

export const STAFF_PLAN_JSON = {
  plan_id: PLAN_STAFF_ID,
  title: "Invite Ravi Kumar as Staff",
  steps: [{ tool: "team.invite", summary: "Invite Ravi Kumar (ravi.k@example.test) as Staff, who handles calls", undoable: false, status: "proposed", error: null }],
  status: "proposed",
  sensitive: "members",
  owner_only: true,
  needs_second_factor: false,
  expires_at: EXPIRES,
};

export const MULTI_PLAN_JSON = {
  plan_id: PLAN_MULTI_ID,
  title: "Set up follow-ups for the new leads",
  steps: [
    { tool: "followups.set_rule", summary: "Follow up every 3 days, stop after 4 tries", undoable: true, status: "proposed", error: null },
    { tool: "auto_reply.sunday_off", summary: "Turn off automatic replies on Sundays", undoable: true, status: "proposed", error: null },
    { tool: "leads.tag", summary: "Tag the 31 new leads “wedding season”", undoable: true, status: "proposed", error: null },
  ],
  status: "proposed",
  sensitive: null,
  owner_only: false,
  needs_second_factor: false,
  expires_at: EXPIRES,
};

export const SECRET_JSON = { kind: "secret", id: KEY_CARD_ID, request_id: KEY_ASK_ID, secret: "indiamart_key", title: "IndiaMART CRM key", hint: "IndiaMART seller panel → Lead Manager → CRM API key. It looks like a long line of letters and numbers.", saved: null };

export const SETUP_INDIAMART_JSON = {
  kind: "setup",
  id: SETUP_INDIAMART_ID,
  setup: "indiamart",
  title: "Connect IndiaMART",
  steps: ["Open seller.indiamart.com and sign in.", "Go to Lead Manager, then Settings, then CRM API key.", "Copy the key and put it in the box below.", "Press “Pull now”: the last day’s enquiries come in as leads."],
  copy: [],
  portals: [],
  secret: { kind: "secret", id: "c1000000-0000-4000-8000-000000000002", request_id: "c2000000-0000-4000-8000-000000000002", secret: "indiamart_key", title: "IndiaMART CRM key", hint: null, saved: null },
  test: "pull_now",
  last_test: null,
  screen: { label: "Lead sources", href: "/lead-sources" },
};

export const SETUP_EMAIL_JSON = {
  kind: "setup",
  id: SETUP_EMAIL_ID,
  setup: "email_forward",
  title: "Forward your lead e-mails here",
  steps: ["Copy your workspace address below.", "In your e-mail, make a rule that forwards the portal’s mails to it.", "Send a test lead to see it arrive."],
  copy: [{ label: "Your workspace address", value: "leads.sri-lakshmi-silks@in.example.test", code: true }],
  portals: [
    { name: "JustDial", steps: ["Mails come from instantemail@justdial.com.", "Gmail: Settings → Filters → From: justdial.com → Forward to the address above."] },
    { name: "TradeIndia", steps: ["Mails come from noreply@tradeindia.com.", "Forward them the same way."] },
  ],
  secret: null,
  test: "send_test_mail",
  last_test: { ok: false, reason: "nothing_arrived", detail: "No mail reached leads.sri-lakshmi-silks@in.example.test in the last 10 minutes.", at: "2026-11-04T09:12:00Z" },
  screen: { label: "Lead sources", href: "/lead-sources" },
};

export const SETUP_FORM_JSON = {
  kind: "setup",
  id: SETUP_FORM_ID,
  setup: "website_form",
  title: "Connect your website form",
  steps: ["Copy the snippet below.", "Paste it into your website, where the form should be.", "Send a test lead from your website."],
  copy: [{ label: "Website snippet", value: '<iframe src="https://forms.example.test/f/sri-lakshmi-silks" width="100%" height="480" title="Enquiry form"></iframe>', code: true }],
  portals: [],
  secret: null,
  test: "send_test_lead",
  last_test: { ok: true, reason: null, detail: "A test lead from sri-lakshmi-silks.example.test arrived at 2:41 pm.", at: "2026-11-04T09:11:00Z" },
  screen: null,
};

export const SETUP_HOURS_JSON = {
  kind: "setup",
  id: SETUP_HOURS_ID,
  setup: "calling_hours",
  title: "Calling hours",
  steps: ["Calls go out only between 10:00 am and 7:00 pm.", "Not on Sundays.", "Press “Test call” to get a call on your own phone."],
  copy: [],
  portals: [],
  secret: null,
  test: "test_call",
  last_test: null,
  screen: { label: "Call settings", href: "/settings?section=assistant" },
};

export const CANT_DO_JSON = { kind: "cant_do", id: CANT_ID, reason: "screen_only", what: "Opening the real-data gate", screen: { label: "Settings → Data", href: "/settings/data" } };
export const NOT_YET_JSON = { kind: "cant_do", id: "e1000000-0000-4000-8000-000000000002", reason: "not_yet", what: "Making a GST invoice", screen: { label: "Orders", href: "/orders" } };

/** A plan card that carries a plan on its own (not inside a file preview); the card's own id is derived from its plan's, like the API's. */
export const planCardJson = (plan: Record<string, unknown>) => ({ kind: "plan", id: typeof plan.plan_id === "string" ? `a2${plan.plan_id.slice(2)}` : PLAN_CARD_ID, plan });

/**
 * The contract's answer to a PDF, a photo or a Word file in the chat until C1's file reading lands (section 1: pdf, image, doc -> `cant_do`, `not_yet`, screen `/settings/knowledge`). In mock mode the
 * chat answers such a file with this card (built in the browser, nothing uploaded); `what` and the label are the person's language, as the API writes them. `n` makes each card's id.
 */
/** The contract's answer to a sheet of prices (no phone or e-mail column): "adding a price list from a file" is not built yet. */
export const PRICE_LIST_NOT_YET_JSON = { kind: "cant_do", id: "e1000000-0000-4000-8000-000000000003", reason: "not_yet", what: "Adding a price list from a file", screen: { label: "Catalogue", href: "/catalogue" } };
/** C1's PR #317: "find new retailers ..." on a Lead Desk workspace. Finding new customers is part of AI Workforce: the Plans link, no price. */
export const NOT_IN_PLAN_JSON = { kind: "cant_do", id: "e1000000-0000-4000-8000-000000000004", reason: "not_in_plan", what: "Finding new retailers in Guntur", screen: { label: "Plans", href: "/plans" }, upgrade_to: "ai_workforce" };
export { notYetFileJson };
export const PDF_NOT_YET_JSON = notYetFileJson(1, "Reading leads or details from brochure-diwali.pdf (a PDF)", "About my business");

export const ACTIVITY_JSON = {
  items: [
    { action_id: "f1000000-0000-4000-8000-000000000001", tool: "lead-imports.commit", summary: "Added 31 leads from leads-guntur-nov.xlsx", changed: "31 new leads, tagged “wedding season”", requested_by: "Srinivas Reddy", message_id: "f2000000-0000-4000-8000-000000000001", at: "2026-11-04T08:40:00Z", status: "done", undo: "available" },
    { action_id: "f1000000-0000-4000-8000-000000000002", tool: "calls.set_hours", summary: "Changed calling hours", changed: "9:30 am – 8:00 pm → 10:00 am – 7:00 pm", requested_by: "Srinivas Reddy", message_id: "f2000000-0000-4000-8000-000000000002", at: "2026-11-04T06:05:00Z", status: "done", undo: "available" },
    { action_id: "f1000000-0000-4000-8000-000000000003", tool: "team.invite", summary: "Invited Ravi Kumar as Staff", changed: null, requested_by: "Srinivas Reddy", message_id: null, at: "2026-11-03T12:20:00Z", status: "done", undo: "none" },
    { action_id: "f1000000-0000-4000-8000-000000000004", tool: "voice.set", summary: "Switched the voice to a male Telugu voice", changed: "Ramya → Kiran", requested_by: "Srinivas Reddy", message_id: null, at: "2026-11-02T10:00:00Z", status: "undone", undo: "done" },
    { action_id: "f1000000-0000-4000-8000-000000000005", tool: "catalogue.update_prices", summary: "Tried to update 18 prices", changed: "Nothing changed: the price list had no prices in one column", requested_by: "Kavya Gowda", message_id: null, at: "2026-11-01T09:30:00Z", status: "failed", undo: "none", error: "invalid" },
  ],
  next_before: null,
};

/** The clock of the fixtures: 4 Nov 2026, 3:30 pm India time (the Activity filter's "today" and "this week" are judged against it). */
export const FIXTURE_NOW = Date.parse("2026-11-04T10:00:00Z");

// ---- the editable import preview (contract docs/contracts/file-import.md, 14 Nov): a photo of a handwritten Telugu list. Made up; the people are invented and the numbers are not real. ----
export const IMPORT_ID = "d3000000-0000-4000-8000-000000000001";
export const IMPORT_PREVIEW_ID = "d3000000-0000-4000-8000-000000000002";
const cell = (value: string, unsure = false, valid: boolean | null = null) => ({ value, unsure, valid });
export const IMPORT_DRAFT_JSON = {
  kind: "file_preview",
  id: IMPORT_PREVIEW_ID,
  import_id: IMPORT_ID,
  file_name: "IMG_2041.jpg",
  destination: "leads",
  destinations: ["leads", "catalogue", "prices"],
  read_by: "ai_handwriting",
  language: "te",
  state: "ready",
  columns: [{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "interest", label: "Interested in" }, { key: "source", label: "Source" }],
  counts: { rows: 6, new: 4, existing: 1, invalid_phone: 1, unsure: 5 },
  rows: [
    { row_id: "r1", include: true, cells: { name: cell("Lakshmi Prasanna"), phone: cell("+910000006701", false, true), interest: cell("Kanchi pattu", true), source: cell("Handwritten list") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "r2", include: true, cells: { name: cell("Venkata Ramana", true), phone: cell("+910000006702", false, true), interest: cell("Wedding set"), source: cell("Handwritten list") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "r3", include: true, cells: { name: cell("Sravani Reddy"), phone: cell("+910000006703", true, true), interest: cell("Gadwal silk"), source: cell("Handwritten list") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "r4", include: true, cells: { name: cell("Padmaja N."), phone: cell("+910000006704", false, true), interest: cell("Bridal sarees", true), source: cell("Handwritten list") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "r5", include: false, cells: { name: cell("Ravi Textiles"), phone: cell("+910000006705", false, true), interest: cell("Cotton"), source: cell("Handwritten list") }, flags: { duplicate_of: { lead_id: "d3000000-0000-4000-8000-0000000000aa", name: "Ravi T." }, invalid_phone: false, missing_required: false } },
    { row_id: "r6", include: false, cells: { name: cell("Anitha"), phone: cell("98765", true, false), interest: cell("Silk"), source: cell("Handwritten list") }, flags: { duplicate_of: null, invalid_phone: true, missing_required: false } },
  ],
  next_cursor: null,
  consent: { required: true, options: ["walk_in", "asked_us", "existing_customer"], chosen: null },
  plan: null,
};
export const IMPORT_CONFIRM_PLAN_JSON = {
  plan_id: "a1000000-0000-4000-8000-0000000000d3",
  title: "Add 4 new leads from IMG_2041.jpg",
  steps: [{ tool: "lead-imports.commit", summary: "Add 4 new leads (1 is already in Leads, 1 has no valid phone: both are left out)", undoable: true, status: "proposed", error: null }],
  status: "proposed",
  sensitive: null,
  owner_only: false,
  needs_second_factor: false,
  expires_at: EXPIRES,
};

/** The same file read as a price list (made up): what the card becomes when the owner sends it to the catalogue prices. */
export const IMPORT_PRICES_JSON = {
  ...IMPORT_DRAFT_JSON,
  destination: "prices",
  columns: [{ key: "item", label: "Item" }, { key: "price", label: "Price" }, { key: "stock", label: "Stock" }],
  counts: { rows: 3, new: 3, existing: 0, invalid_phone: 0, unsure: 2 },
  rows: [
    { row_id: "p1", include: true, cells: { item: cell("Kanchi pattu, red border"), price: cell("24,500", true), stock: cell("6") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "p2", include: true, cells: { item: cell("Gadwal silk"), price: cell("9,800"), stock: cell("14", true) }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
    { row_id: "p3", include: true, cells: { item: cell("Ilkal cotton"), price: cell("1,450"), stock: cell("40") }, flags: { duplicate_of: null, invalid_phone: false, missing_required: false } },
  ],
  consent: null,
};
