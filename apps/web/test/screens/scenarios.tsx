/**
 * What the screen snapshot renders: one entry per screen under /app, with the API answers it needs. See screens.test.tsx.
 * Everything here is synthetic. The fixtures come from lib/api/*-fixtures.ts where they exist.
 */
import type { ReactElement } from "react";

import { ApiRequestError, parseMe } from "@/lib/api/client";
import { parseItemTypes } from "@/lib/api/item-types";
import { parseQuotePolicyVersions } from "@/lib/api/quote-policies";
import { parseRequest } from "@/lib/api/erasure";
import { parseStatus } from "@/lib/api/suppression";
import { parseAgentCost, parseRun } from "@/lib/api/agents";
import { parseIcpConfig, parseReviewQueuePage } from "@/lib/api/leads";
import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";
import { parseOrderPage as parseOrders } from "@/lib/api/orders";
import { parsePlan } from "@/lib/api/plan";
import { parseAccountSetup } from "@/lib/api/account";
import { parseAiUsage } from "@/lib/api/ai-usage";
import { agentsStatus, todayFor } from "./today-fixtures";
import { SETTINGS_JSON, STATUS_JSON } from "@/lib/api/scheduler-fixtures";
import { SETTINGS, TODAY_VISITS, parseVisitFixture, slotsJson, visitJson } from "@/lib/api/visits-fixtures";
import { parseCallRequestPage, parseOutboxPage, parseOutboxSummary } from "@/lib/api/outbox";
import { CALL_JSON, PRICE_JSON, QUIET_JSON, SENT_JSON, page as outboxPage } from "@/lib/api/outbox-fixtures";
import { parseItem, parseItemPage } from "@/lib/api/catalogue";
import { ITEM_A, ITEM_HIDDEN, SUMMARIES, itemJson, pageJson, photoJson, PHOTO_B1, summaryJson } from "@/lib/api/catalogue-fixtures";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";
import { parseRequirementView } from "@/lib/api/enquiries";
import { parseDueList, parseLeadFollowup, parsePolicyVersion, parseQuestionDraft } from "@/lib/api/followups";
import { BODY_TEXT, DRAFT_JSON, DUE_JSON, FOLLOWUP_JSON, GATE_JSON, POLICY_JSON, QUESTION_JSON, TOUCH_JSON } from "@/lib/api/followups-fixtures";
import { parseMembers, parseOrderDetail, parseOrderPage } from "@/lib/api/orders";
import { DETAIL_JSON, MEMBERS_JSON, ORDER_JSON } from "@/lib/api/orders-fixtures";
import { parsePage } from "@/lib/api/crm";
import { CLAIM, CLAIM_ACCEPTED, COMPANY, COMPANY2_JSON, COMPANY_JSON, CONTACT, CONTACT_JSON, ENQ, ENQUIRY, EVIDENCE_PAGE, LEAD, LEAD_JSON, OPPORTUNITY_JSON, PRODUCT_JSON, REQUIREMENT, REQUIREMENT_CONFIRMED, REQUIREMENT_DRAFT, TENANT, requirementJson } from "./fixtures";
import type { Handler } from "./state";

export const ROLES = ["owner", "admin", "sales", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export { TENANT, LEAD, ENQ, COMPANY, CONTACT, REQUIREMENT };
export const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

export type Scenario = {
  id: string;
  /** Roles to render; default all four. */
  roles?: readonly Role[];
  /** The session level to use; default: aal2 for owner and admin (they have an authenticator), aal1 for the others. */
  aal?: "aal1" | "aal2";
  render: () => Promise<ReactElement>;
  handlers: (role: Role) => Record<string, Handler>;
};

export const tenantOf = (role: Role) => ({ id: TENANT, name: "Demo Silks (synthetic)", slug: "demo-silks", role });
/** The answer every workspace screen needs first, and the two small reads a screen may add (the plan; the AI usage, which the API gives to Owner and Admin only). */
export const base = (role: Role): Record<string, Handler> => ({
  fetchTenant: () => tenantOf(role),
  getPlan: () => parsePlan({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-01T05:00:00Z" }),
  getAiUsage: () => {
    if (role !== "owner" && role !== "admin") throw new ApiRequestError(403, "forbidden", "Not allowed.");
    return parseAiUsage({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" });
  },
});

export const props = <T,>(params: Record<string, string> = {}, search: Record<string, string> = {}): T =>
  ({ params: Promise.resolve({ tenantId: TENANT, ...params }), searchParams: Promise.resolve(search) }) as unknown as T;

const SCENARIO_LIST: Scenario[] = [];
export const add = (s: Scenario) => {
  SCENARIO_LIST.push(s);
};
export const SCENARIOS = SCENARIO_LIST;

// ---- /app ------------------------------------------------------------------------------------------------------------
add({
  id: "account-workspaces",
  render: async () => (await import("@/app/app/page")).default(),
  handlers: (role) => ({
    fetchMe: () => parseMe({ user_id: "11111111-1111-4111-8111-111111111111", memberships: [{ role, tenant: { id: TENANT, name: "Demo Silks (synthetic)", slug: "demo-silks" } }, { role: "viewer", tenant: { id: "22222222-2222-2222-2222-222222222223", name: "Second shop (synthetic)", slug: "second-shop" } }] }),
  }),
});
add({
  id: "account-just-signed-up",
  roles: ["owner"],
  render: async () => (await import("@/app/app/page")).default(),
  handlers: () => ({ fetchMe: () => parseMe({ user_id: "11111111-1111-4111-8111-111111111111", memberships: [] }), fetchAccountSetup: () => parseAccountSetup({ state: "needed", tenant_id: null, business_name: "Demo Silks (synthetic)" }) }),
});
add({
  id: "account-invited-no-workspace",
  roles: ["owner"],
  render: async () => (await import("@/app/app/page")).default(),
  handlers: () => ({ fetchMe: () => parseMe({ user_id: "11111111-1111-4111-8111-111111111111", memberships: [] }), fetchAccountSetup: () => parseAccountSetup({ state: "none", tenant_id: null, business_name: null }) }),
});
add({
  id: "account-security",
  render: async () => (await import("@/app/app/security/page")).default({ searchParams: Promise.resolve({}) } as never),
  handlers: () => ({}),
});

// ---- small forms -----------------------------------------------------------------------------------------------------
add({
  id: "customers-new",
  render: async () => (await import("@/app/app/tenants/[tenantId]/customers/new/page")).default(props({})),
  handlers: base,
});
add({
  id: "products-new",
  render: async () => (await import("@/app/app/tenants/[tenantId]/products/new/page")).default(props({})),
  handlers: base,
});
add({
  id: "price-list",
  render: async () => (await import("@/app/app/tenants/[tenantId]/price-list/page")).default(props({})),
  handlers: base,
});

// ---- orders ----------------------------------------------------------------------------------------------------------
add({
  id: "orders-list",
  render: async () => (await import("@/app/app/tenants/[tenantId]/orders/page")).default(props({})),
  handlers: (role) => ({
    ...base(role),
    fetchOrders: () =>
      parseOrderPage({
        items: [
          ORDER_JSON,
          { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", order_no: 8, state: "cancelled", outcome: "cancelled", paid_paise: 882000, refunded_paise: 100000, net_paise: 782000 },
          { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", order_no: 9, state: "closed_paid", outcome: "won", paid_paise: 15000000, net_paise: 15000000, balance_paise: 0 },
        ],
        next_cursor: "a b",
      }),
  }),
});
add({
  id: "orders-detail",
  render: async () => (await import("@/app/app/tenants/[tenantId]/orders/[orderId]/page")).default(props({ orderId: ORDER })),
  handlers: (role) => ({
    ...base(role),
    fetchOrder: () => parseOrderDetail(DETAIL_JSON),
    fetchMembers: () => parseMembers(MEMBERS_JSON),
  }),
});

// ---- the workspace home and its five tabs --------------------------------------------------------------------------------
const TABS = {
  companies: [COMPANY_JSON, COMPANY2_JSON],
  contacts: [CONTACT_JSON],
  products: [PRODUCT_JSON],
  leads: [LEAD_JSON],
  opportunities: [OPPORTUNITY_JSON],
} as const;
for (const tab of Object.keys(TABS) as (keyof typeof TABS)[]) {
  add({
    id: `workspace-home-${tab}`,
    roles: tab === "companies" ? ROLES : ["owner"],
    render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, { tab })),
    handlers: (role) => ({
      ...base(role),
      fetchPage: () => parsePage(tab, { items: TABS[tab], next_cursor: tab === "companies" ? "abc" : null }),
      fetchDataPolicy: () => ({ real_data_allowed: false }),
    }),
  });
}
// Today: the home with no ?tab= (Job AE). What each role is given follows the database's rule (test/screens/today-fixtures.ts); with the reads failing it says "Not available yet" in each place.
add({
  id: "today",
  render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, {})),
  handlers: (role) => ({
    ...base(role),
    getToday: () => todayFor(role),
    getAgentsStatus: () => agentsStatus(),
    fetchQuotes: () => [parseQuoteSummary(SUMMARY_JSON)],
    fetchMembers: () => parseMembers(MEMBERS_JSON),
    // the store today (job AV): three visits, the first free time, the week's figure (Owner and Admin) and a visit Agent OWL proposed (everyone but a Viewer)
    getTodayVisits: () => ({ date: "2026-10-06", items: TODAY_VISITS.map((v, i) => ({ ...v, starts_at: ["2026-10-06T05:00:00Z", "2026-10-06T06:30:00Z", "2026-10-06T10:30:00Z"][i] })) }),
    getSlots: () => slotsJson("2026-10-06"),
    listVisits: () => ({ from: "2026-10-06", to: "2026-12-06", items: [parseVisitFixture(visitJson({ source: "assistant", status: "booked", date: "2026-10-08", starts_at: "2026-10-08T05:30:00Z", ends_at: "2026-10-08T06:00:00Z", created_at: "2026-10-06T03:30:00Z" }))] }),
    getAiUsageWeek: () => ({ week_percent: 12, resets_at_week: "2026-10-11T18:30:00Z" }),
    getOutboxSettings: () => ({ platform_switch_on: false, auto_send_enabled: true, per_customer_daily_limit: 3 }),
    // the words of the message held for approval (Owner and Admin), the call request (Owner), and the last 24 hours of the log (everyone but a Viewer; the clock of this test is 2026-10-06 10:00 in India)
    listOutboxApprovals: () => parseOutboxPage(outboxPage([PRICE_JSON])),
    listCallRequests: () => parseCallRequestPage(outboxPage([CALL_JSON])),
    listOutboxMessages: () =>
      parseOutboxPage(
        outboxPage([
          { ...SENT_JSON, id: "11111111-aaaa-4aaa-8aaa-0000000000a1", sent_at: "2026-10-06T02:00:00Z" },
          { ...SENT_JSON, id: "11111111-aaaa-4aaa-8aaa-0000000000a2", sent_at: "2026-10-05T20:00:00Z" },
          { ...SENT_JSON, id: "11111111-aaaa-4aaa-8aaa-0000000000a3", category: "info", sent_at: "2026-10-05T19:00:00Z" },
          { ...QUIET_JSON, scheduled_for: "2026-10-06T06:30:00Z" },
          { ...PRICE_JSON, created_at: "2026-10-06T04:45:00Z" },
        ]),
      ),
  }),
});
add({
  id: "today-unreadable",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, {})),
  handlers: (role) => ({
    ...base(role),
    getToday: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getAgentsStatus: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    fetchMembers: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getTodayVisits: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getSlots: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    listVisits: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getAiUsageWeek: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getOutboxSettings: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
  }),
});
add({
  id: "workspace-home-empty",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, { tab: "leads" })),
  handlers: (role) => ({ ...base(role), fetchPage: () => parsePage("leads", { items: [], next_cursor: null }), fetchDataPolicy: () => ({ real_data_allowed: true }) }),
});

// ---- company, lead, consent ------------------------------------------------------------------------------------------------
add({
  id: "company",
  render: async () => (await import("@/app/app/tenants/[tenantId]/companies/[companyId]/page")).default(props({ companyId: COMPANY }, { section: "all" })),
  handlers: (role) => ({
    ...base(role),
    fetchCompany: () => parsePage("companies", { items: [COMPANY_JSON], next_cursor: null }).items[0],
    fetchEvidencePage: () => EVIDENCE_PAGE,
    fetchClaims: () => [CLAIM, CLAIM_ACCEPTED],
  }),
});
add({
  id: "lead",
  render: async () => (await import("@/app/app/tenants/[tenantId]/leads/[leadId]/page")).default(props({ leadId: LEAD }, { section: "all" })),
  handlers: (role) => ({
    ...base(role),
    fetchLead: () => parsePage("leads", { items: [LEAD_JSON], next_cursor: null }).items[0],
    fetchEvidencePage: () => EVIDENCE_PAGE,
    fetchClaims: () => [CLAIM],
    fetchLeadEnquiries: () => [ENQUIRY],
    fetchLeadContactId: () => CONTACT,
  }),
});
add({
  id: "consent",
  render: async () => (await import("@/app/app/tenants/[tenantId]/contacts/[contactId]/consent/page")).default(props({ contactId: CONTACT })),
  handlers: (role) => ({ ...base(role), fetchContact: () => parsePage("contacts", { items: [CONTACT_JSON], next_cursor: null }).items[0] }),
});

// ---- follow-ups ----------------------------------------------------------------------------------------------------------
const POLICY_VERSIONS = [parsePolicyVersion(POLICY_JSON), parsePolicyVersion({ ...POLICY_JSON, id: "99999999-9999-4999-8999-999999999998", version_no: 2, effective_from: "2026-10-08", max_touches: 4 })];
add({
  id: "followups-due",
  render: async () => (await import("@/app/app/tenants/[tenantId]/followups/page")).default(props({})),
  handlers: (role) => ({
    ...base(role),
    fetchDueList: () =>
      parseDueList({
        items: [
          ...DUE_JSON,
          { ...DUE_JSON[0], lead_id: "33333333-3333-3333-3333-333333333334", action: "wait", reason_code: "too_soon", open_draft_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", open_draft_channel: "whatsapp", default_channel: "whatsapp" },
        ],
        next_cursor: null,
        policy_in_force: true,
        left_out: 2,
      }),
  }),
});
add({
  id: "followups-due-empty",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/followups/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchDueList: () => parseDueList({ items: [], next_cursor: null, policy_in_force: false, left_out: 0 }) }),
});
add({
  id: "followups-policy",
  render: async () => (await import("@/app/app/tenants/[tenantId]/followups/policy/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchPolicyVersions: () => POLICY_VERSIONS }),
});
const approvedDraft = { ...DRAFT_JSON, id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", status: "approved", approved_by: "ffffffff-ffff-4fff-8fff-fffffffffff1", approved_at: "2026-10-07T07:00:00+00:00", body: BODY_TEXT + " (approved)" };
add({
  id: "lead-followup",
  render: async () => (await import("@/app/app/tenants/[tenantId]/leads/[leadId]/followup/page")).default(props({ leadId: LEAD }, { section: "all" })),
  handlers: (role) => ({ ...base(role), fetchLeadFollowup: () => parseLeadFollowup({ ...FOLLOWUP_JSON, drafts: [DRAFT_JSON, approvedDraft], touches: [TOUCH_JSON] }) }),
});
add({
  id: "lead-followup-blocked",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/leads/[leadId]/followup/page")).default(props({ leadId: LEAD }, { section: "all" })),
  handlers: (role) => ({
    ...base(role),
    fetchLeadFollowup: () =>
      parseLeadFollowup({
        ...FOLLOWUP_JSON,
        gate: { ...GATE_JSON, blocked: "consent", policy_in_force: true },
        decision: null,
        channels: [{ channel: "email", blocked: "consent" }, { channel: "whatsapp", blocked: "unkeyed" }],
        drafts: [],
      }),
  }),
});
add({
  id: "requirement-questions",
  render: async () => (await import("@/app/app/tenants/[tenantId]/requirements/[requirementId]/questions/page")).default(props({ requirementId: REQUIREMENT })),
  handlers: (role) => ({
    ...base(role),
    fetchQuestionDrafts: () => [parseQuestionDraft(QUESTION_JSON), parseQuestionDraft({ ...QUESTION_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", question_code: "missing_quantity", question_text: "How many pieces do you need?", status: "approved" })],
  }),
});

// ---- catalogue and policy ----------------------------------------------------------------------------------------------------
const TYPES = parseItemTypes([TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON]);
add({
  id: "item-types",
  render: async () => (await import("@/app/app/tenants/[tenantId]/item-types/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchItemTypes: () => TYPES }),
});
add({
  id: "item-types-no-second-factor",
  roles: ["owner", "admin"],
  aal: "aal1",
  render: async () => (await import("@/app/app/tenants/[tenantId]/item-types/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchItemTypes: () => TYPES }),
});
const POLICY_VERSION = {
  id: "55555555-5555-4555-8555-555555555555", version_no: 1, effective_from: "2026-10-01", discount_ceiling_bps: 0, shipping_flat_fee_paise: 0, shipping_free_above_paise: null, shipping_tax_bps: 0,
  validity_days: 7, new_advance_bps: 5000, repeat_advance_bps: 2500, new_net_days: 10, repeat_net_days: 45, gst_rate_bps: 500, gst_effective_from: "2026-10-01", tax_mode: "exclusive",
  rounding_mode: "half_up", repeat_credit_limit_paise: 250000, seller_state: "TG", required_inputs: ["delivery_state"], created_at: "2026-10-01T10:00:00.000000+00:00", in_force: true,
};
const QUOTE_POLICIES = parseQuotePolicyVersions([
  POLICY_VERSION,
  { ...POLICY_VERSION, id: "55555555-5555-4555-8555-555555555556", version_no: 2, effective_from: "2026-10-20", in_force: false, shipping_flat_fee_paise: 15000, shipping_free_above_paise: 5000000, discount_ceiling_bps: 500 },
]);
add({
  id: "quote-policy",
  render: async () => (await import("@/app/app/tenants/[tenantId]/quote-policy/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchQuotePolicyVersions: () => QUOTE_POLICIES }),
});
add({
  id: "quote-policy-no-second-factor",
  roles: ["owner", "admin"],
  aal: "aal1",
  render: async () => (await import("@/app/app/tenants/[tenantId]/quote-policy/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchQuotePolicyVersions: () => QUOTE_POLICIES }),
});
add({
  id: "followups-policy-no-second-factor",
  roles: ["owner"],
  aal: "aal1",
  render: async () => (await import("@/app/app/tenants/[tenantId]/followups/policy/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchPolicyVersions: () => POLICY_VERSIONS }),
});
add({
  id: "price-list-no-second-factor",
  roles: ["owner"],
  aal: "aal1",
  render: async () => (await import("@/app/app/tenants/[tenantId]/price-list/page")).default(props({})),
  handlers: base,
});

// ---- privacy and suppression ---------------------------------------------------------------------------------------------------
const ERASURES = {
  items: [
    { id: "ee000000-0000-4000-8000-000000000001", scope: "contact", subject_id: CONTACT, status: "pending", requested_by: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-05T05:00:00+00:00", execute_after: "2026-10-05T05:00:00+00:00", executed_by: null, executed_at: null, cancelled_by: null, cancelled_at: null, result: null },
    {
      id: "ee000000-0000-4000-8000-000000000002", scope: "company", subject_id: COMPANY, status: "executed", requested_by: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-01T05:00:00+00:00", execute_after: "2026-10-01T05:00:00+00:00", executed_by: "11111111-1111-4111-8111-111111111111", executed_at: "2026-10-01T06:00:00+00:00", cancelled_by: null, cancelled_at: null,
      result: { request_id: "ee000000-0000-4000-8000-000000000002", scope: "company", status: "executed", dry_run: false, counts: { contacts: 2, evidence: 3 }, review: [{ table: "evidence", column: "snippet", id: "ee000000-0000-4000-8000-0000000000aa" }], review_truncated: false, exports_logged: 1, note: "Done.", replayed: false },
    },
  ],
};
add({
  id: "privacy",
  render: async () => (await import("@/app/app/tenants/[tenantId]/privacy/page")).default(props({})),
  handlers: (role) => ({
    ...base(role),
    fetchErasureRequests: () => ({ items: ERASURES.items.map(parseRequest), next_cursor: null }),
    confirmationPhrase: () => "ERASE Ravi Kumar (synthetic)",
    fetchPage: (...a: unknown[]) => (a[2] === "contacts" ? parsePage("contacts", { items: [CONTACT_JSON], next_cursor: null }) : parsePage("companies", { items: [COMPANY_JSON], next_cursor: null })),
  }),
});
add({
  id: "privacy-no-second-factor",
  roles: ["owner"],
  aal: "aal1",
  render: async () => (await import("@/app/app/tenants/[tenantId]/privacy/page")).default(props({})),
  handlers: (role) => ({
    ...base(role),
    fetchErasureRequests: () => ({ items: [], next_cursor: null }),
    fetchPage: (...a: unknown[]) => (a[2] === "contacts" ? parsePage("contacts", { items: [CONTACT_JSON], next_cursor: null }) : parsePage("companies", { items: [COMPANY_JSON], next_cursor: null })),
  }),
});
for (const [name, status] of [
  ["no-key", { key_configured: false, key_version: null, unkeyed_contacts: null }],
  ["unkeyed", { key_configured: true, key_version: 1, unkeyed_contacts: 7 }],
  ["clear", { key_configured: true, key_version: 1, unkeyed_contacts: 0 }],
] as const) {
  add({
    id: `suppression-${name}`,
    roles: name === "unkeyed" ? ROLES : ["owner"],
    render: async () => (await import("@/app/app/tenants/[tenantId]/suppression/page")).default(props({})),
    handlers: (role) => ({ ...base(role), fetchSuppressionStatus: () => parseStatus(status) }),
  });
}

// ---- assistant ------------------------------------------------------------------------------------------------------------------
add({
  id: "suggestions",
  render: async () => (await import("@/app/app/tenants/[tenantId]/suggestions/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchAgentClaims: () => [CLAIM, CLAIM_ACCEPTED] }),
});
add({
  id: "suggestions-empty",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/suggestions/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchAgentClaims: () => [] }),
});
const RUN = {
  id: "aa000000-0000-4000-8000-000000000001", agent_name: "selftest", agent_version: "selftest-1", status: "running", started_by: "11111111-1111-4111-8111-111111111111", company_id: COMPANY, lead_id: null,
  created_at: "2026-10-04T12:00:00+00:00", expires_at: "2026-10-04T12:15:00+00:00", finished_at: null, error_code: null, cancel_requested: false, max_writes: 6, writes_used: 3, max_tool_calls: 10, tool_calls_used: 2,
  max_input_tokens: 1000, input_tokens_used: 100, max_output_tokens: 1000, output_tokens_used: 50, max_cost_micros: 100000, cost_micros_used: 400,
};
const agentsHandlers = (role: Role, enabled: boolean): Record<string, Handler> => ({
  ...base(role),
  fetchAgentSettings: () => ({ enabled }),
  fetchRuns: () => ({ items: [parseRun(RUN), parseRun({ ...RUN, id: "aa000000-0000-4000-8000-000000000002", agent_name: "research", status: "failed", company_id: null, lead_id: LEAD, error_code: "model_failed", finished_at: "2026-10-04T12:05:00+00:00" })], next_cursor: null }),
  fetchAgentCost: () => parseAgentCost({ day: "2026-10-04", cap_micros: 2000000, settled_micros: 400, open_micros: 900, open: [{ run_id: RUN.id, step_key: "s1", reserved_micros: 900, run_status: "running", created_at: "2026-10-04T12:00:00+00:00" }] }),
  fetchPage: (...a: unknown[]) => (a[2] === "leads" ? parsePage("leads", { items: [LEAD_JSON], next_cursor: null }) : parsePage("companies", { items: [COMPANY_JSON], next_cursor: null })),
});
add({ id: "agents-on", render: async () => (await import("@/app/app/tenants/[tenantId]/agents/page")).default(props({})), handlers: (role) => agentsHandlers(role, true) });
add({ id: "agents-off", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/agents/page")).default(props({})), handlers: (role) => agentsHandlers(role, false) });

// ---- the review queue ----------------------------------------------------------------------------------------------------------------
const ICP = parseIcpConfig({ id: "44444444-4444-4444-4444-444444444444", tenant_id: TENANT, version_no: 1, engine: "icp-rules", schema_version: 1, config: {}, config_sha256: "0123456789abcdef0123456789abcdef", created_by: null, created_via: "manual", created_at: "2026-10-04T00:00:00Z" });
const REVIEW_LEADS = [
  { lead_id: LEAD, status: "new", source: "directory", created_at: "2026-10-04T01:00:00Z", company: { name: "Kanchipuram Silks Emporium", city: "Bengaluru", country: "IN", industry: "Silk Wholesale" }, contact: { full_name: "Gowtham", email: "gowtham@example.test", phone: "+0098765432", job_title: "Proprietor" }, latest_label: null, score: null, score_max_reachable: null, score_band: null, snapshot: null },
  {
    lead_id: "33333333-3333-3333-3333-333333333335", status: "new", source: "referral", created_at: "2026-10-04T02:00:00Z", company: { name: "Dharmavaram Saree Traders", city: "Dharmavaram", country: "IN", industry: "Saree Retailing" }, contact: null,
    latest_label: { id: "label-2", tenant_id: TENANT, lead_id: "33333333-3333-3333-3333-333333333335", label: "bad", reason_code: "wrong_product", icp_version_id: ICP.id, score: 35, score_max_reachable: 100, snapshot: null, created_by: "u", created_via: "manual", created_at: "2026-10-04T02:30:00Z" },
    score: 35, score_max_reachable: 100, score_band: "low_priority",
    snapshot: { factors: [{ id: "silk_saree_fit", points: 0, max_points: 25, unknown: false }, { id: "buyer_type_fit", points: 0, max_points: 20, unknown: true }, { id: "geography_fit", points: 12, max_points: 20, unknown: false }], flags: ["no_evidence"] },
  },
];
for (const [name, query] of [["blind", {}], ["unblinded", { blind: "false" }], ["unreviewed", { unreviewed: "true" }]] as const) {
  add({
    id: `review-${name}`,
    roles: name === "blind" ? ROLES : ["owner"],
    render: async () => (await import("@/app/app/tenants/[tenantId]/review/page")).default(props({}, query)),
    handlers: (role) => ({
      ...base(role),
      fetchActiveIcpConfig: () => ICP,
      fetchReviewQueue: (...a: unknown[]) => {
        const blind = (a[2] as { blind?: boolean }).blind !== false;
        return parseReviewQueuePage({
          items: REVIEW_LEADS.map((l) => (blind ? { ...l, score: null, score_band: null, snapshot: null, score_max_reachable: null } : l)),
          next_cursor: "cur1",
        });
      },
    }),
  });
}
add({
  id: "review-empty",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/review/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchActiveIcpConfig: () => { throw new Error("none"); }, fetchReviewQueue: () => parseReviewQueuePage({ items: [], next_cursor: null }) }),
});

// ---- the enquiry: requirement and quote flow, in each state a person can meet --------------------------------------------------------
const APPROVED = { approved_by: "11111111-1111-4111-8111-111111111111", approved_at: "2026-10-06T06:00:00+00:00", status: "approved", outcome: "approved" };
const enquiryScenario = (id: string, over: { roles?: readonly Role[]; aal?: "aal1" | "aal2"; query?: Record<string, string>; handlers: (role: Role) => Record<string, Handler> }) =>
  add({
    id,
    roles: over.roles,
    aal: over.aal,
    render: async () => (await import("@/app/app/tenants/[tenantId]/enquiries/[enquiryId]/page")).default(props({ enquiryId: ENQ }, { section: "all", ...over.query })),
    handlers: (role) => ({ ...base(role), fetchEnquiry: () => ENQUIRY, ...over.handlers(role) }),
  });
const quoteSide = (role: Role, quote: object, summary: object, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  fetchRequirement: () => REQUIREMENT_CONFIRMED,
  fetchQuoteSetup: () => parseSetup(SETUP_JSON),
  fetchEnquiryQuotes: () => [parseQuoteSummary(summary)],
  fetchQuote: () => parseQuote(quote),
  fetchItemTypes: () => TYPES,
  fetchQuotePolicyVersions: () => QUOTE_POLICIES,
  ...extra,
});
enquiryScenario("enquiry-requirement-draft", { handlers: () => ({ fetchRequirement: () => REQUIREMENT_DRAFT, fetchQuoteSetup: () => parseSetup({ ...SETUP_JSON, requirement_status: "draft", missing: ["saree_type"], lines: [] }), fetchEnquiryQuotes: () => [], fetchItemTypes: () => TYPES, fetchQuotePolicyVersions: () => QUOTE_POLICIES }) });
enquiryScenario("enquiry-no-requirement", { roles: ["owner", "viewer"], handlers: () => ({ fetchRequirement: () => parseRequirementView({ ...requirementJson("draft"), requirement: null, fields: [], lines: [], flags: [], questions: [] }), fetchQuoteSetup: () => parseSetup({ ...SETUP_JSON, requirement_status: null, lines: [], missing: [] }), fetchEnquiryQuotes: () => [] }) });
enquiryScenario("enquiry-draft-quote", { handlers: (role) => quoteSide(role, QUOTE_JSON, SUMMARY_JSON) });
enquiryScenario("enquiry-draft-quote-no-second-factor", { roles: ["owner"], aal: "aal1", handlers: (role) => quoteSide(role, { ...QUOTE_JSON, needs_owner_approval: true, review_flags: ["advance_below_policy"] }, { ...SUMMARY_JSON, needs_owner_approval: true }) });
enquiryScenario("enquiry-approved-quote", {
  handlers: (role) =>
    quoteSide(role, { ...QUOTE_JSON, ...APPROVED }, { ...SUMMARY_JSON, ...APPROVED }, {
      fetchQuoteText: () => parseQuoteText(TEXT_JSON),
      fetchOrders: () => parseOrders({ items: [], next_cursor: null }),
      fetchLeadFollowup: () => parseLeadFollowup({ ...FOLLOWUP_JSON, channel: "whatsapp", channels: [{ channel: "whatsapp", blocked: null }], default_channel: "whatsapp" }),
    }),
});
enquiryScenario("enquiry-approved-quote-whatsapp-blocked", {
  roles: ["owner"],
  handlers: (role) =>
    quoteSide(role, { ...QUOTE_JSON, ...APPROVED }, { ...SUMMARY_JSON, ...APPROVED }, {
      fetchQuoteText: () => parseQuoteText(TEXT_JSON),
      fetchOrders: () => parseOrders({ items: [ORDER_JSON], next_cursor: null }),
      fetchLeadFollowup: () => parseLeadFollowup({ ...FOLLOWUP_JSON, channel: "whatsapp", channels: [{ channel: "whatsapp", blocked: "consent" }], gate: { ...GATE_JSON, blocked: "consent" }, decision: null, default_channel: "whatsapp" }),
      fetchLeadContactId: () => CONTACT,
    }),
});
enquiryScenario("enquiry-manual-quote", { roles: ["owner", "admin", "sales"], handlers: (role) => quoteSide(role, MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON) });
enquiryScenario("enquiry-manual-quote-approved", {
  roles: ["owner"],
  handlers: (role) =>
    quoteSide(role, { ...MANUAL_QUOTE_JSON, ...APPROVED }, { ...MANUAL_SUMMARY_JSON, ...APPROVED }, {
      fetchQuoteText: () => parseQuoteText(TEXT_JSON),
      fetchOrders: () => parseOrders({ items: [], next_cursor: null }),
      fetchLeadFollowup: () => parseLeadFollowup({ ...FOLLOWUP_JSON, channel: "whatsapp", channels: [{ channel: "whatsapp", blocked: null }], default_channel: "whatsapp" }),
    }),
});
enquiryScenario("enquiry-quote-api-down", { roles: ["owner"], handlers: () => ({ fetchRequirement: () => REQUIREMENT_CONFIRMED, fetchQuoteSetup: () => { throw new ApiRequestError(503, "api_unreachable", "x"); }, fetchEnquiryQuotes: () => [] }) });
enquiryScenario("enquiry-captured-notice", { roles: ["owner"], query: { captured: "changed" }, handlers: () => ({ fetchRequirement: () => REQUIREMENT_DRAFT, fetchQuoteSetup: () => parseSetup({ ...SETUP_JSON, requirement_status: "draft", lines: [] }), fetchEnquiryQuotes: () => [], fetchItemTypes: () => TYPES, fetchQuotePolicyVersions: () => QUOTE_POLICIES }) });

// ---- when the workspace cannot be read ---------------------------------------------------------------------------------------------
add({
  id: "orders-api-down",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/orders/page")).default(props({})),
  handlers: (role) => ({ ...base(role), fetchOrders: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }),
});
add({
  id: "workspace-not-found",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/orders/page")).default(props({})),
  handlers: () => ({ fetchTenant: () => { throw new ApiRequestError(404, "not_found", "x"); } }),
});
add({
  id: "workspace-api-down",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/followups/page")).default(props({})),
  handlers: () => ({ fetchTenant: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }),
});

// ---- screens of the new menu whose data layer has not landed yet (Job AC, batch C1): a title and "Not available yet" ---------------------------------
add({ id: "quotes-list", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => ({ ...base(role), fetchQuotes: () => [parseQuoteSummary(SUMMARY_JSON), parseQuoteSummary(MANUAL_SUMMARY_JSON)] }) });
add({ id: "quotes-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => ({ ...base(role), fetchQuotes: () => [] }) });
add({ id: "quotes-viewer", roles: ["viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => base(role) });
// ---- store visits (job AV) -------------------------------------------------------------------------------------------------
const dayVisits = [
  parseVisitFixture(visitJson({ id: "d894bfa2-0aaf-4700-85a9-70e4fa125fc1", status: "confirmed", date: "2026-10-06", starts_at: "2026-10-06T05:00:00Z", ends_at: "2026-10-06T05:30:00Z" })),
  parseVisitFixture(visitJson({ id: "7e456fad-378a-485d-839a-5d34ee346c42", who: "Anita R.", contact_name: "Anita R.", party_size: 1, purpose: null, status: "booked", source: "assistant", date: "2026-10-06", starts_at: "2026-10-06T06:30:00Z", ends_at: "2026-10-06T07:00:00Z" })),
  parseVisitFixture(visitJson({ id: "7604201c-580a-4c63-93b4-8bc4c3b7724e", who: "Lakshmi Textiles", contact_name: null, party_size: 2, purpose: "Silk saree wholesale", status: "completed", outcome: "will_return", date: "2026-10-06", starts_at: "2026-10-06T04:30:00Z", ends_at: "2026-10-06T05:00:00Z" })),
];
add({
  id: "visits",
  render: async () => (await import("@/app/app/tenants/[tenantId]/visits/page")).default(props({}, {})),
  handlers: (role) => ({ ...base(role), listVisits: () => ({ from: "2026-10-06", to: "2026-10-06", items: dayVisits }), getSlots: () => slotsJson("2026-10-06", { "11:00": 0 }) }),
});
add({
  id: "visits-hours",
  render: async () => (await import("@/app/app/tenants/[tenantId]/visits/page")).default(props({}, { view: "hours" })),
  handlers: (role) => ({ ...base(role), getVisitSettings: () => SETTINGS }),
});
add({
  id: "visits-unreadable",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/visits/page")).default(props({}, {})),
  handlers: (role) => ({ ...base(role), listVisits: () => { throw new ApiRequestError(503, "api_unreachable", "x"); }, getSlots: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }),
});
// ---- This week, the owner's report (job BV) ---------------------------------------------------------------------------------
const reportHandlers = (role: Role): Record<string, Handler> => ({
  ...base(role),
  listVisits: () => ({ from: "2026-10-05", to: "2026-10-11", items: dayVisits }),
  getOutboxSummary: () => parseOutboxSummary({ waiting: 1, scheduled: 1, sent: 7, blocked: 2, due_now: 0, held_for_later: 1 }),
  listOutboxMessages: () => parseOutboxPage(outboxPage([{ ...SENT_JSON, reason: "owner_approved", created_at: "2026-10-06T01:00:00Z", decided_at: "2026-10-06T01:20:00Z", sent_at: "2026-10-06T01:21:00Z" }])),
  getAiUsageWeek: () => ({ week_percent: 37, resets_at_week: "2026-10-11T18:30:00Z" }),
});
add({ id: "report", render: async () => (await import("@/app/app/tenants/[tenantId]/report/page")).default(props({})), handlers: reportHandlers });
add({
  id: "report-empty",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/report/page")).default(props({})),
  handlers: (role) => ({
    ...reportHandlers(role),
    listVisits: () => ({ from: "2026-10-05", to: "2026-10-11", items: [] }),
    getOutboxSummary: () => parseOutboxSummary({ waiting: 0, scheduled: 0, sent: 0, blocked: 0, due_now: 0, held_for_later: 0 }),
    listOutboxMessages: () => parseOutboxPage(outboxPage([])),
    getAiUsageWeek: () => ({ week_percent: 0, resets_at_week: "2026-10-11T18:30:00Z" }),
  }),
});
add({
  id: "report-unreadable",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/report/page")).default(props({})),
  handlers: (role) => ({
    ...reportHandlers(role),
    listVisits: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getOutboxSummary: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    listOutboxMessages: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
    getAiUsageWeek: () => { throw new ApiRequestError(503, "api_unreachable", "x"); },
  }),
});
// ---- the friendly pages for a refused or rate-limited call (job BW) -----------------------------------------------------------
add({ id: "problem-403", roles: ["owner"], render: async () => (await import("@/app/app/problem/[kind]/page")).default(props({ kind: "403" })), handlers: (role) => base(role) });
add({ id: "problem-429", roles: ["owner"], render: async () => (await import("@/app/app/problem/[kind]/page")).default(props({ kind: "429" })), handlers: (role) => base(role) });
// ---- the outbox and Agent OWL's settings (job AX) ---------------------------------------------------------------------------
const outboxItems = (status: string) => {
  const m = (over: Record<string, unknown>) => ({ ...SENT_JSON, ...over });
  if (status === "needs_approval") return [{ ...PRICE_JSON, created_at: "2026-10-06T03:12:00Z" }];
  if (status === "queued") return [{ ...QUIET_JSON, scheduled_for: "2026-10-07T03:30:00Z", created_at: "2026-10-06T00:00:00Z" }];
  if (status === "sent") return [m({ sent_at: "2026-10-06T02:00:00Z", created_at: "2026-10-06T01:59:00Z" })];
  if (status === "blocked") return [m({ id: "11111111-aaaa-4aaa-8aaa-0000000000e1", status: "blocked", reason: "stopped", reason_text: "The customer asked us to stop. Nothing more is sent.", sent_at: null, created_at: "2026-10-05T20:00:00Z" })];
  return [];
};
const outboxHandlers = (role: Role): Record<string, Handler> => ({
  ...base(role),
  // the server does the filtering now (job BE): the tab names are the API's, and blocked also holds failed
  listOutboxMessages: (_t: unknown, _i: unknown, opts: unknown) => parseOutboxPage(outboxPage(outboxItems(({ waiting: "needs_approval", scheduled: "queued", sent: "sent", blocked: "blocked" } as Record<string, string>)[(opts as { tab: string }).tab]))),
  getOutboxSummary: () => parseOutboxSummary({ waiting: 1, scheduled: 1, sent: 1, blocked: 1, due_now: 0, held_for_later: 1 }),
  getOutboxSettings: () => ({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }),
  getSchedulerStatus: () => ({ ...STATUS_JSON, last_run_at: "2026-10-06T04:28:00Z", next_run_at: "2026-10-06T04:31:00Z" }),
});
add({ id: "outbox", roles: ["owner", "admin", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/outbox/page")).default(props({}, {})), handlers: outboxHandlers });
add({ id: "outbox-sent", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/outbox/page")).default(props({}, { tab: "sent" })), handlers: outboxHandlers });
add({ id: "outbox-blocked", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/outbox/page")).default(props({}, { tab: "blocked" })), handlers: outboxHandlers });
add({
  id: "settings-agent",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "agent" })),
  handlers: (role) => ({ ...outboxHandlers(role), getSchedulerSettings: () => SETTINGS_JSON }),
});
add({ id: "help", render: async () => (await import("@/app/app/tenants/[tenantId]/help/page")).default(props({})), handlers: (role) => ({ ...base(role) }) });
add({ id: "help-guide-today", render: async () => (await import("@/app/app/tenants/[tenantId]/help/[guide]/page")).default(props({ guide: "today" })), handlers: (role) => ({ ...base(role) }) });
add({ id: "help-guide-outbox-english-only", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/help/[guide]/page")).default(props({ guide: "outbox" })), handlers: (role) => ({ ...base(role) }) });
add({ id: "office", render: async () => (await import("@/app/app/tenants/[tenantId]/office/page")).default(props({})), handlers: (role) => ({ ...base(role), getAgentsStatus: () => agentsStatus() }) });
add({ id: "office-agent-chosen", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/office/page")).default(props({}, { agent: "quote_writer" })), handlers: (role) => ({ ...base(role), getAgentsStatus: () => agentsStatus() }) });
add({ id: "office-unreadable", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/office/page")).default(props({})), handlers: (role) => ({ ...base(role), getAgentsStatus: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }) });
add({ id: "integrations", render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/page")).default(props({})), handlers: (role) => base(role) });
for (const section of ["business", "language", "security", "privacy"] as const) {
  add({ id: `settings-${section}`, roles: section === "privacy" ? ROLES : ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section })), handlers: (role) => base(role) });
}
add({ id: "settings-members", roles: ["owner", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "members" })), handlers: (role) => ({ ...base(role), fetchMembers: () => parseMembers(MEMBERS_JSON) }) });
add({ id: "settings-members-unreadable", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "members" })), handlers: (role) => ({ ...base(role), fetchMembers: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }) });

// ---- the saree catalogue (job BC) ----------------------------------------------------------------------------------------------
const catalogueRows = (opts: unknown): Record<string, unknown>[] => {
  const o = (opts ?? {}) as { includeInactive?: boolean; fabric?: string; inStock?: boolean };
  return SUMMARIES.filter((r) => (r.active === true || o.includeInactive === true) && (!o.fabric || r.fabric === o.fabric) && (!o.inStock || r.stock_status !== "made_to_order"));
};
const catalogueHandlers = (role: Role): Record<string, Handler> => ({
  ...base(role),
  listCatalogueItems: (_t: unknown, _i: unknown, opts: unknown) => parseItemPage(pageJson(catalogueRows(opts))),
  getCatalogueItem: (_t: unknown, _i: unknown, id: unknown) => {
    if (id === ITEM_HIDDEN) return parseItem(itemJson({ id: ITEM_HIDDEN, name: "DEMO Old Banarasi (hidden)", active: false, fabric: "banarasi", fabric_label: "Banarasi", price_paise: null, price_text: null }, [photoJson(PHOTO_B1, 1)]));
    if (id === ITEM_A) return parseItem(itemJson());
    throw new ApiRequestError(404, "not_found", "x");
  },
});
const cataloguePage = async () => (await import("@/app/app/tenants/[tenantId]/catalogue/page")).default;
add({ id: "catalogue", render: async () => (await cataloguePage())(props({}, {})), handlers: catalogueHandlers });
add({ id: "catalogue-filtered", roles: ["owner"], render: async () => (await cataloguePage())(props({}, { fabric: "soft_silk", stock: "few_left", q: "blue" })), handlers: catalogueHandlers });
add({ id: "catalogue-nomatch", roles: ["owner"], render: async () => (await cataloguePage())(props({}, { q: "zzz" })), handlers: catalogueHandlers });
add({ id: "catalogue-empty", roles: ["owner", "sales"], render: async () => (await cataloguePage())(props({}, {})), handlers: (role) => ({ ...base(role), listCatalogueItems: () => parseItemPage(pageJson([])) }) });
add({ id: "catalogue-unreadable", roles: ["owner"], render: async () => (await cataloguePage())(props({}, {})), handlers: (role) => ({ ...base(role), listCatalogueItems: () => { throw new ApiRequestError(503, "catalogue_unavailable", "x"); } }) });
add({ id: "catalogue-item", render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/[itemId]/page")).default(props({ itemId: ITEM_A }, {})), handlers: catalogueHandlers });
add({ id: "catalogue-item-saved", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/[itemId]/page")).default(props({ itemId: ITEM_A }, { saved: "1" })), handlers: catalogueHandlers });
add({ id: "catalogue-item-hidden", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/[itemId]/page")).default(props({ itemId: ITEM_HIDDEN }, {})), handlers: catalogueHandlers });
add({ id: "catalogue-item-missing", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/[itemId]/page")).default(props({ itemId: "9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d" }, {})), handlers: catalogueHandlers });
add({ id: "catalogue-new", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/new/page")).default(props({}, {})), handlers: base });
add({ id: "catalogue-edit", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/[itemId]/edit/page")).default(props({ itemId: ITEM_A }, {})), handlers: catalogueHandlers });
void summaryJson;
