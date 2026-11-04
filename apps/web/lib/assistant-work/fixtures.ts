/**
 * Synthetic answers for the assistant's work cards and Settings > Activity, in the API's wire shape (ASSUMED until docs/contracts/assistant-tools.md), so every fixture goes through the real parser.
 * Used by the tests, the screen snapshot, the fixture-only preview page and the "mock" mode of ASSISTANT_WORK_SCREENS. Every name, number and key is made up.
 */
export const TENANT_BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";

export const PLAN_IMPORT_ID = "a1000000-0000-4000-8000-000000000001";
export const PLAN_HOURS_ID = "a1000000-0000-4000-8000-000000000002";
export const PLAN_STAFF_ID = "a1000000-0000-4000-8000-000000000003";
export const PLAN_MULTI_ID = "a1000000-0000-4000-8000-000000000004";
export const PREVIEW_ID = "b1000000-0000-4000-8000-000000000001";
export const PREVIEW_CAT_ID = "b1000000-0000-4000-8000-000000000002";
export const SECRET_ID = "c1000000-0000-4000-8000-000000000001";
export const SETUP_INDIAMART_ID = "d1000000-0000-4000-8000-000000000001";
export const SETUP_EMAIL_ID = "d1000000-0000-4000-8000-000000000002";
export const SETUP_FORM_ID = "d1000000-0000-4000-8000-000000000003";
export const SETUP_HOURS_ID = "d1000000-0000-4000-8000-000000000004";
export const CANT_ID = "e1000000-0000-4000-8000-000000000001";

export const IMPORT_PLAN_JSON = {
  plan_id: PLAN_IMPORT_ID,
  title: "Add 31 new leads from leads-guntur-nov.xlsx",
  steps: [
    { tool: "leads.import", summary: "Add 31 new leads (4 are already in Leads and are left as they are; 2 have no phone; 1 looks like a supplier and is left out)", undoable: true },
    { tool: "leads.tag", summary: "Tag them “wedding season”", undoable: true },
  ],
  sensitive: null,
  owner_only: false,
  status: "proposed",
  expires_at: "2026-11-04T18:30:00Z",
};

export const PREVIEW_JSON = {
  kind: "file_preview",
  preview_id: PREVIEW_ID,
  file_name: "leads-guntur-nov.xlsx",
  destination: "leads",
  counts: { found: 38, existing: 4, no_phone: 2, supplier: 1 },
  columns: ["Name", "Phone", "Town", "Wants"],
  sample_rows: [
    ["Lakshmi Prasanna", "+91 98480 1XXXX", "Guntur", "Kanchi pattu, 40 sarees"],
    ["Venkata Ramana Rao", "+91 94401 2XXXX", "Tenali", "Wedding set"],
    ["Sravani Reddy", "", "Narasaraopet", "Gadwal silk"],
  ],
  plan: IMPORT_PLAN_JSON,
};

export const CATALOGUE_PREVIEW_JSON = {
  kind: "file_preview",
  preview_id: PREVIEW_CAT_ID,
  file_name: "price-list-nov.pdf",
  destination: "catalogue",
  counts: { found: 24, existing: 18, no_price: 2 },
  columns: ["Item", "Price", "Stock"],
  sample_rows: [
    ["Mysore silk, plain border", "₹ 6,800", "12"],
    ["Ilkal cotton", "₹ 1,450", "40"],
  ],
  plan: {
    plan_id: "a1000000-0000-4000-8000-000000000005",
    title: "Update 18 prices and add 6 new items",
    steps: [{ tool: "catalogue.update_prices", summary: "Change the price of 18 items (each old price is kept, so this can be undone)", undoable: true }, { tool: "catalogue.add_items", summary: "Add 6 new items (2 have no price and are added as hidden)", undoable: true }],
    sensitive: "money",
    status: "proposed",
  },
};

export const HOURS_PLAN_JSON = {
  plan_id: PLAN_HOURS_ID,
  title: "Change calling hours to 10 am – 7 pm",
  steps: [{ tool: "calls.set_hours", summary: "Calling hours: 10:00 am to 7:00 pm, Monday to Saturday (now 9:30 am to 8:00 pm)", undoable: true }],
  sensitive: null,
  owner_only: true,
  status: "proposed",
};

export const STAFF_PLAN_JSON = {
  plan_id: PLAN_STAFF_ID,
  title: "Invite Ravi Kumar as Staff",
  steps: [{ tool: "team.invite", summary: "Invite Ravi Kumar (ravi.k@example.test) as Staff, who handles calls", undoable: false }],
  sensitive: "members",
  status: "proposed",
};

export const MULTI_PLAN_JSON = {
  plan_id: PLAN_MULTI_ID,
  title: "Set up follow-ups for the new leads",
  steps: [
    { tool: "followups.set_rule", summary: "Follow up every 3 days, stop after 4 tries", undoable: true },
    { tool: "auto_reply.sunday_off", summary: "Turn off automatic replies on Sundays", undoable: true },
    { tool: "leads.tag", summary: "Tag the 31 new leads “wedding season”", undoable: true },
  ],
  sensitive: null,
  status: "proposed",
};

export const SECRET_JSON = { kind: "secret", request_id: SECRET_ID, secret: "indiamart_key", title: "IndiaMART CRM key", hint: "IndiaMART seller panel → Lead Manager → CRM API key. It looks like a long line of letters and numbers.", saved: null };

export const SETUP_INDIAMART_JSON = {
  kind: "setup",
  setup_id: SETUP_INDIAMART_ID,
  setup: "indiamart",
  title: "Connect IndiaMART",
  steps: ["Open seller.indiamart.com and sign in.", "Go to Lead Manager, then Settings, then CRM API key.", "Copy the key and put it in the box below.", "Press “Pull now”: the last day’s enquiries come in as leads."],
  secret: { request_id: "c1000000-0000-4000-8000-000000000002", secret: "indiamart_key", title: "IndiaMART CRM key", hint: null, saved: null },
  test: "pull_now",
  last_test: null,
  screen: { label: "Lead sources", href: "/lead-sources" },
};

export const SETUP_EMAIL_JSON = {
  kind: "setup",
  setup_id: SETUP_EMAIL_ID,
  setup: "email_forward",
  title: "Forward your lead e-mails here",
  steps: ["Copy your workspace address below.", "In your e-mail, make a rule that forwards the portal’s mails to it.", "Send a test lead to see it arrive."],
  copy: [{ label: "Your workspace address", value: "leads.sri-lakshmi-silks@in.example.test", code: true }],
  portals: [
    { name: "JustDial", steps: ["Mails come from instantemail@justdial.com.", "Gmail: Settings → Filters → From: justdial.com → Forward to the address above."] },
    { name: "TradeIndia", steps: ["Mails come from noreply@tradeindia.com.", "Forward them the same way."] },
  ],
  test: "send_test_mail",
  last_test: { ok: false, reason: "nothing_arrived", detail: "No mail reached leads.sri-lakshmi-silks@in.example.test in the last 10 minutes.", at: "2026-11-04T09:12:00Z" },
  screen: { label: "Lead sources", href: "/lead-sources" },
};

export const SETUP_FORM_JSON = {
  kind: "setup",
  setup_id: SETUP_FORM_ID,
  setup: "website_form",
  title: "Connect your website form",
  steps: ["Copy the snippet below.", "Paste it into your website, where the form should be.", "Send a test lead from your website."],
  copy: [{ label: "Website snippet", value: '<script src="https://forms.example.test/f.js" data-form="sri-lakshmi-silks" async></script>', code: true }],
  test: "send_test_lead",
  last_test: { ok: true, reason: null, detail: "A test lead from sri-lakshmi-silks.example.test arrived at 2:41 pm.", at: "2026-11-04T09:11:00Z" },
};

export const SETUP_HOURS_JSON = {
  kind: "setup",
  setup_id: SETUP_HOURS_ID,
  setup: "calling_hours",
  title: "Calling hours",
  steps: ["Calls go out only between 10:00 am and 7:00 pm.", "Not on Sundays.", "Press “Test call” to get a call on your own phone."],
  test: "test_call",
  last_test: null,
  screen: { label: "Call settings", href: "/settings?section=assistant" },
};

export const CANT_DO_JSON = { kind: "cant_do", card_id: CANT_ID, reason: "screen_only", what: "Opening real customer data is always done by a person, on its own screen.", screen: { label: "Privacy and data", href: "/settings?section=privacy" } };
export const NOT_YET_JSON = { kind: "cant_do", card_id: "e1000000-0000-4000-8000-000000000002", reason: "not_yet", what: "I can’t make a GST invoice yet.", screen: { label: "Orders", href: "/orders" } };

/** A plan card that carries a plan on its own (not inside a file preview). */
export const planCardJson = (plan: Record<string, unknown>) => ({ kind: "plan", plan });

export const ACTIVITY_JSON = {
  items: [
    { action_id: "f1000000-0000-4000-8000-000000000001", tool: "leads.import", summary: "Added 31 leads from leads-guntur-nov.xlsx", changed: "31 new leads, tagged “wedding season”", requested_by: "Srinivas Reddy", message_id: "f2000000-0000-4000-8000-000000000001", at: "2026-11-04T08:40:00Z", status: "done", undo: "available" },
    { action_id: "f1000000-0000-4000-8000-000000000002", tool: "calls.set_hours", summary: "Changed calling hours", changed: "9:30 am – 8:00 pm → 10:00 am – 7:00 pm", requested_by: "Srinivas Reddy", message_id: "f2000000-0000-4000-8000-000000000002", at: "2026-11-04T06:05:00Z", status: "done", undo: "available" },
    { action_id: "f1000000-0000-4000-8000-000000000003", tool: "team.invite", summary: "Invited Ravi Kumar as Staff", changed: null, requested_by: "Srinivas Reddy", message_id: null, at: "2026-11-03T12:20:00Z", status: "done", undo: "none" },
    { action_id: "f1000000-0000-4000-8000-000000000004", tool: "voice.set", summary: "Switched the voice to a male Telugu voice", changed: "Ramya → Kiran", requested_by: "Srinivas Reddy", message_id: null, at: "2026-11-02T10:00:00Z", status: "undone", undo: "done" },
    { action_id: "f1000000-0000-4000-8000-000000000005", tool: "catalogue.update_prices", summary: "Tried to update 18 prices", changed: "Nothing changed: the price list had no prices in one column", requested_by: "Kavya Gowda", message_id: null, at: "2026-11-01T09:30:00Z", status: "failed", undo: "none" },
  ],
  next_before: null,
};

/** The clock of the fixtures: 4 Nov 2026, 3:30 pm India time (the Activity filter's "today" and "this week" are judged against it). */
export const FIXTURE_NOW = Date.parse("2026-11-04T10:00:00Z");
