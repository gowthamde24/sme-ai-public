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
import { parseEnquiry, parseRequirementView } from "@/lib/api/enquiries";
import { parseDueList, parseLeadFollowup, parsePolicyVersion, parseQuestionDraft } from "@/lib/api/followups";
import { BODY_TEXT, DRAFT_JSON, DUE_JSON, FOLLOWUP_JSON, GATE_JSON, POLICY_JSON, QUESTION_JSON, TOUCH_JSON } from "@/lib/api/followups-fixtures";
import { parseMembers, parseOrderDetail, parseOrderPage } from "@/lib/api/orders";
import { DETAIL_JSON, MEMBERS_JSON, ORDER_JSON } from "@/lib/api/orders-fixtures";
import { parsePage } from "@/lib/api/crm";
import { CLAIM, CLAIM_ACCEPTED, COMPANY, COMPANY2_JSON, COMPANY_JSON, CONTACT, CONTACT_JSON, ENQ, ENQUIRY, EVIDENCE_PAGE, LEAD, LEAD_JSON, OPPORTUNITY_JSON, PRODUCT_JSON, REQUIREMENT, REQUIREMENT_CONFIRMED, REQUIREMENT_DRAFT, TENANT, requirementJson } from "./fixtures";
import { parsePolicyStatus } from "@/lib/api/policy";
import { defaultPackId, otherPackIds, packFields, workspacePack } from "@/lib/packs/pack-test-kit";
import { parseProfile } from "@/lib/api/profile";
import { parseAccount, parseConversationPage, parseTemplates, parseThread } from "@/lib/api/whatsapp";
import { parseItem as parseMaterialItem, parseItemList as parseMaterialItemList, parsePolicy as parseMaterialPolicy, parseQuoteDetail as parseMaterialQuoteDetail, parseQuoteList as parseMaterialQuoteList } from "@/lib/api/materials";
import { ITEM_BARE_JSON, ITEM_JSON as MATERIAL_ITEM_JSON, LIST_JSON as MATERIAL_LIST_JSON, POLICY_JSON as MATERIAL_POLICY_JSON, QUOTE_APPROVED_JSON, QUOTE_DETAIL_JSON, QUOTE_FLAGGED_JSON, QUOTE_LIST_JSON, QUOTE as MATERIAL_QUOTE } from "@/lib/api/materials-fixtures";
import { parseSite, parseSiteList } from "@/lib/api/sites";
import { parseCallList, parseCampaignList, parseDetail, parsePreview, parseRecipients, parseResults } from "@/lib/api/campaigns";
import {
  parseAdmissionDetail, parseAdmissionList, parseFeeEntries, parseFeePlan, parseFeePlanList, parseFeeReceipt, parseFeeStatement, parseGuardianFees, parseLateFeesPreview, parsePending, parseProfile as parseInstitution, parseProgrammes, parseStudent, parseStudentList,
} from "@/lib/api/education";
import * as EDU from "@/lib/api/education-fixtures";
import { parseCatalogue, parseReport } from "@/lib/api/reports";
import * as RPT from "@/lib/api/reports-fixtures";
import { CALL_LIST_JSON, CAMPAIGN, DETAIL_ISSUES_JSON, DETAIL_JSON as CAMPAIGN_DETAIL_JSON, DETAIL_RUNNING_JSON, LIST_JSON, PREVIEW_ISSUES_JSON, PREVIEW_JSON, RECIPIENTS_JSON, RESULTS_JSON } from "@/lib/api/campaigns-fixtures";
import { SITE as SITE_ID, SITE_JSON, SITE_LIST_JSON } from "@/lib/api/sites-fixtures";
import { parseChallan, parseTripDetail, parseTripList } from "@/lib/api/deliveries";
import { CHALLAN_JSON, TRIP as TRIP_ID, TRIP_DETAIL_JSON, TRIP_LIST_JSON, TRIP_ON_THE_WAY_JSON } from "@/lib/api/deliveries-fixtures";
import { parseEntries as parseLedgerEntries, parseReceipt as parseLedgerReceipt, parseStatement as parseLedgerStatement, parseSummary as parseLedgerSummary } from "@/lib/api/ledger";
import { COMPANY as LEDGER_COMPANY, ENTRIES_JSON, ENTRY_PAYMENT, RECEIPT_JSON, STATEMENT_JSON, SUMMARY_JSON as LEDGER_SUMMARY_JSON } from "@/lib/api/ledger-fixtures";
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
  getReportCatalogue: () => parseCatalogue(RPT.CATALOGUE_WEEKLY_JSON),
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
for (const section of ["business", "language", "security"] as const) {
  add({ id: `settings-${section}`, roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section })), handlers: (role) => ({ ...base(role), getBusinessProfile: () => ({ gstin: "27AAPFU0939F1ZV", state: "Maharashtra" }) }) });
}
// Settings > Data and > Privacy (job CC): the invented answers of the new reads
const DATA_HANDLERS = {
  getCalendarFeed: () => ({ active: true, created_at: "2026-10-06T04:00:00Z", last_used_at: null }),
  getExportFormats: () => ["tally_zip", "vyapar_xlsx", "csv", "xlsx"],
  listImportJobs: () => [{ id: "11111111-aaaa-4aaa-8aaa-0000000000d1", kind: "customers", status: "completed", counts: {}, created_at: "2026-10-05T10:00:00Z", completed_at: "2026-10-05T10:01:00Z" }],
};
const PRIVACY_HANDLERS = {
  listMyExports: () => [{ id: "11111111-aaaa-4aaa-8aaa-0000000000e2", scope: "person", status: "ready", requested_at: "2026-10-06T03:00:00Z", ready_at: "2026-10-06T03:00:30Z", expires_at: "2026-10-07T03:00:30Z", size_bytes: 12345, error_code: null }],
  listMyDeletions: () => [],
  listWorkspaceDeletions: () => [{ id: "11111111-aaaa-4aaa-8aaa-0000000000e3", kind: "workspace", status: "scheduled", requested_at: "2026-10-06T03:00:00Z", execute_after: "2026-10-20T03:00:00Z", cancelled_at: null, executed_at: null, blocked_reason: null }],
  readConsentList: () => ({
    checked: 3,
    truncated: false,
    stopped: [{ id: "11111111-aaaa-4aaa-8aaa-0000000000c1", name: "Asha Rao", reason: "opted_out", channels: { email: "unknown", whatsapp: "withdrawn", phone: "unknown" } }],
    counts: { whatsapp: { unknown: 1, granted: 1, withdrawn: 1 }, phone: { unknown: 3, granted: 0, withdrawn: 0 }, email: { unknown: 2, granted: 1, withdrawn: 0 } },
  }),
};
add({ id: "settings-data", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "data" })), handlers: (role) => ({ ...base(role), ...DATA_HANDLERS }) });
add({ id: "settings-privacy", roles: ROLES, render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "privacy" })), handlers: (role) => ({ ...base(role), ...PRIVACY_HANDLERS }) });
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

// ---- Find retailers (job CC) ---------------------------------------------------------------------------------------------------
const RESEARCH_STATUS = { tools: { web_search: { enabled: false, used_today: null, daily_limit: null }, read_page: { enabled: false, used_today: null, daily_limit: null }, find_retailers: { enabled: true, used_today: 2, daily_limit: 10 }, metal_prices: { enabled: false, used_today: null, daily_limit: null } } };
add({ id: "retailers", roles: ROLES, render: async () => (await import("@/app/app/tenants/[tenantId]/retailers/page")).default(props({})), handlers: (role) => ({ ...base(role), getResearchStatus: () => RESEARCH_STATUS }) });
add({ id: "retailers-off", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/retailers/page")).default(props({})), handlers: (role) => ({ ...base(role), getResearchStatus: () => ({ tools: { ...RESEARCH_STATUS.tools, find_retailers: { enabled: false, used_today: null, daily_limit: null } } }) }) });
add({ id: "retailers-unreadable", roles: ["admin"], render: async () => (await import("@/app/app/tenants/[tenantId]/retailers/page")).default(props({})), handlers: (role) => ({ ...base(role), getResearchStatus: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }) });

// ---- the team and joining a business (job CC) ----------------------------------------------------------------------------------
const TEAM = {
  members: [
    { user_id: "11111111-1111-4111-8111-111111111111", display_name: "Asha Rao", role: "owner", joined_at: "2026-10-01T04:00:00Z", is_you: true },
    { user_id: "22222222-aaaa-4aaa-8aaa-000000000001", display_name: "Ravi Kumar", role: "sales", joined_at: "2026-10-03T04:00:00Z", is_you: false },
    { user_id: "22222222-aaaa-4aaa-8aaa-000000000002", display_name: null, role: "viewer", joined_at: null, is_you: false },
  ],
  pending_invitations: 1,
};
const INVITATIONS = [{ id: "22222222-aaaa-4aaa-8aaa-0000000000a1", role: "sales", label: "for the new cutter", status: "pending", created_at: "2026-10-05T04:00:00Z", expires_at: "2026-10-12T04:00:00Z", accepted_at: null, revoked_at: null, created_by_name: "Asha Rao" }];
add({ id: "team", roles: ROLES, render: async () => (await import("@/app/app/tenants/[tenantId]/team/page")).default(props({})), handlers: (role) => ({ ...base(role), getTeam: () => ({ ...TEAM, members: TEAM.members.map((m) => ({ ...m, is_you: m.user_id === "11111111-1111-4111-8111-111111111111" ? role === "owner" : false })) }), listInvitations: () => INVITATIONS }) });
add({ id: "team-unreadable", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/team/page")).default(props({})), handlers: (role) => ({ ...base(role), getTeam: () => { throw new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 20); }, listInvitations: () => { throw new ApiRequestError(403, "forbidden", "x"); } }) });
add({ id: "join", roles: ["sales"], render: async () => (await import("@/app/app/join/page")).default(), handlers: (role) => base(role) });

// ---- WhatsApp: Connect, the chat inbox and a chat (job CC) -------------------------------------------------------------------
const WA_ACCOUNT = { configured: true, status: "active", waba_id: "123456789", phone_number_id: "987654321", display_phone: "+91 98765 43210", coexistence: false, token_ref: "SHOP_TOKEN", token_available: true, updated_at: "2026-10-06T03:00:00Z" };
const WA_TEMPLATES = { templates: [{ id: "55555555-aaaa-4aaa-8aaa-0000000000b1", name: "shop_update", language: "te", category: "utility", purpose: "followup", body: "x {{1}} y", status: "approved", updated_at: "2026-10-06T03:00:00Z" }] };
const waHandlers = (role: Role, account: Record<string, unknown> = WA_ACCOUNT) => ({ ...base(role), getWhatsappAccount: () => parseAccount(account), listTemplates: () => parseTemplates(WA_TEMPLATES) });
add({ id: "whatsapp-connected", roles: ["owner", "admin"], render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/whatsapp/page")).default(props({})), handlers: (role) => waHandlers(role) });
add({ id: "whatsapp-not-connected", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/whatsapp/page")).default(props({})), handlers: (role) => ({ ...waHandlers(role, { configured: false, status: "none" }), listTemplates: () => parseTemplates({ templates: [] }) }) });
add({ id: "whatsapp-needs-attention", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/whatsapp/page")).default(props({})), handlers: (role) => waHandlers(role, { ...WA_ACCOUNT, token_available: false, status: "pending" }) });
add({ id: "whatsapp-sales", roles: ["sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/whatsapp/page")).default(props({})), handlers: (role) => waHandlers(role) });
const LEAD_ID = "33333333-aaaa-4aaa-8aaa-000000000001";
const CONVERSATIONS = { conversations: [{ lead_id: LEAD_ID, contact_id: "x", name: "Ravi Kumar", company: "WhatsApp customer 3fa9c1", phone: "+919876543210", last_at: "2026-10-06T03:30:00Z", last_direction: "in", preview: "Do you have red sarees?", last_inbound_at: "2026-10-06T03:30:00Z", window_open: true, window_expires_at: "2026-10-07T03:30:00Z", unread: true, stopped: false }, { lead_id: "33333333-aaaa-4aaa-8aaa-000000000002", contact_id: "y", name: "Asha Rao", company: null, phone: "+919876500000", last_at: "2026-10-04T03:30:00Z", last_direction: "out", preview: "Thank you, see you soon.", last_inbound_at: null, window_open: false, window_expires_at: null, unread: false, stopped: true }], next_before: null };
add({ id: "chats", roles: ["owner", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/chats/page")).default(props({}, {})), handlers: (role) => ({ ...base(role), listConversations: () => parseConversationPage(CONVERSATIONS) }) });
add({ id: "chats-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/chats/page")).default(props({}, {})), handlers: (role) => ({ ...base(role), listConversations: () => parseConversationPage({ conversations: [], next_before: null }) }) });
add({ id: "chats-unreadable", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/chats/page")).default(props({}, {})), handlers: (role) => ({ ...base(role), listConversations: () => { throw new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30); } }) });
const THREAD = { lead_id: LEAD_ID, contact_id: "x", name: "Ravi Kumar", phone: "+919876543210", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: "2026-10-07T03:30:00Z", next_before: null, items: [
  { direction: "out", id: "44444444-aaaa-4aaa-8aaa-000000000003", at: "2026-10-06T03:40:00Z", text: "Yes, we have red sarees. The price is 4,500 each.", status: "needs_approval", reason: "money", source: "owner", delivery: null, delivered_at: null, read_at: null, delivery_error: null, failure_code: null, photos: 0 },
  { direction: "out", id: "44444444-aaaa-4aaa-8aaa-000000000002", at: "2026-10-06T03:35:00Z", text: "Welcome!", status: "sent", reason: "auto_allowed", source: "owner", delivery: "read", delivered_at: "2026-10-06T03:35:10Z", read_at: "2026-10-06T03:36:00Z", delivery_error: null, failure_code: null, photos: 1 },
  { direction: "in", id: "44444444-aaaa-4aaa-8aaa-000000000001", at: "2026-10-06T03:30:00Z", text: "Do you have red sarees?" },
] };
const chatHandlers = (role: Role, thread: Record<string, unknown> = THREAD) => ({ ...base(role), getThread: () => parseThread(thread), getOutboxSettings: () => ({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }) });
add({ id: "chat", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/chats/[leadId]/page")).default(props({ leadId: LEAD_ID })), handlers: (role) => chatHandlers(role) });
add({ id: "chat-stopped", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/chats/[leadId]/page")).default(props({ leadId: LEAD_ID })), handlers: (role) => chatHandlers(role, { ...THREAD, stopped: true, window_open: false, items: [{ ...THREAD.items[0], status: "blocked", reason: "stopped" }, THREAD.items[2]] }) });

// ---- accepting a changed Terms or Privacy Policy (job CC) ----------------------------------------------------------------------
const POLICY = { current: { terms: { version: "2026-11-01", effective_from: "2026-11-10" }, privacy: { version: "2026-10-01" } }, accepted: [], needs_acceptance: { terms: true, privacy: true }, blocking: true };
add({ id: "accept", roles: ["owner"], render: async () => (await import("@/app/app/accept/page")).default({ searchParams: Promise.resolve({}) }), handlers: (role) => ({ ...base(role), getPolicyStatus: () => parsePolicyStatus(POLICY) }) });

// ---- business types (job CL): the same screens for a construction and an education workspace ---------------------------------------------------------------
// The words, modules and fields are the real files of packages/packs through the API's shapes (lib/packs/pack-test-kit). Every scenario above runs with NO pack handler (a server with no pack routes: the product as it
// always was), and `today-default-pack` below runs the default business type of an existing workspace and must read exactly like `today`.
const CONSTRUCTION = otherPackIds().find((i) => workspacePack(i).modules.includes("deliveries"))!;
const EDUCATION = otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!;
const packOf = (id: string, source: "signup" | "default" | "legacy" = "signup") => () => workspacePack(id, source);
const packCardReads: Record<string, Handler> = {
  listTrips: () => parseTripList(TRIP_LIST_JSON),
  listMaterialQuotes: () => parseMaterialQuoteList(QUOTE_LIST_JSON),
  getLedgerSummary: () => parseLedgerSummary(LEDGER_SUMMARY_JSON),
};

const fieldsOf = (id: string) => () => packFields(id);
const SECURITY_FIRST_LEVEL = () => ({ level: "aal1" as const, neededFor: ["approvals", "whatsapp_connect", "rules_and_prices", "imports_and_exports", "team_and_privacy"] });
const SAMPLE_NONE = () => ({ loaded: false, counts: { companies: 0, contacts: 0, leads: 0, products: 0 } });
const SAMPLE_LOADED = () => ({ loaded: true, counts: { companies: 2, contacts: 3, leads: 3, products: 4 } });
const PROFILE_DONE = () => parseProfile({ name: "Pavers Corner (synthetic)", town: "Guntur", languages: ["en", "te"], setup_complete: true });
const PROFILE_NEW = () => parseProfile({ name: "My business", town: null, languages: ["en"], setup_complete: false });
const todayBase = SCENARIO_LIST.find((s) => s.id === "today")!.handlers;
const startPage = async () => (await import("@/app/app/tenants/[tenantId]/start/page")).default(props({}));
const todayPage = (query: Record<string, string> = {}) => async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, query));
add({ id: "start-classic", roles: ["owner"], render: startPage, handlers: (role) => ({ ...base(role), getProfile: PROFILE_NEW }) });
add({ id: "start-construction", roles: ["owner", "sales"], render: startPage, handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(CONSTRUCTION), getProfile: PROFILE_NEW, getAccountSecurity: SECURITY_FIRST_LEVEL }) });
add({ id: "start-education-done-profile", roles: ["admin"], render: startPage, handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(EDUCATION), getProfile: PROFILE_DONE, getAccountSecurity: SECURITY_FIRST_LEVEL }) });
add({ id: "today-default-pack", roles: ["owner"], render: todayPage(), handlers: (role) => ({ ...todayBase(role), getWorkspacePack: packOf(defaultPackId(), "legacy"), getExampleStatus: SAMPLE_NONE, getProfile: PROFILE_DONE }) });
add({ id: "today-construction", roles: ["owner", "sales"], render: todayPage(), handlers: (role) => ({ ...todayBase(role), getWorkspacePack: packOf(CONSTRUCTION), ...packCardReads, getExampleStatus: SAMPLE_NONE, getProfile: PROFILE_DONE, getAccountSecurity: SECURITY_FIRST_LEVEL }) });
add({ id: "today-education-example-loaded", roles: ["owner"], render: todayPage({ example: "loaded" }), handlers: (role) => ({ ...todayBase(role), getWorkspacePack: packOf(EDUCATION), ...eduCardReads, getExampleStatus: SAMPLE_LOADED, getProfile: PROFILE_DONE }) });
add({ id: "today-example-failed", roles: ["owner"], render: todayPage({ example: "unavailable" }), handlers: (role) => ({ ...todayBase(role), getWorkspacePack: packOf(CONSTRUCTION), ...packCardReads, getExampleStatus: SAMPLE_NONE, getProfile: PROFILE_DONE }) });
add({ id: "today-example-removed-some-kept", roles: ["owner"], render: todayPage({ example: "removed", kept: "3" }), handlers: (role) => ({ ...todayBase(role), getWorkspacePack: packOf(CONSTRUCTION), ...packCardReads, getExampleStatus: SAMPLE_NONE, getProfile: PROFILE_DONE }) });
const school = (role: Role): Record<string, Handler> => ({ ...base(role), getWorkspacePack: packOf(EDUCATION) });
const eduCardReads: Record<string, Handler> = {
  runReport: (_t: unknown, _tenant: unknown, code: unknown) => parseReport(code === "education.today" ? EDU.TODAY_REPORT_JSON : code === "education.funnel" ? EDU.FUNNEL_REPORT_JSON : EDU.COLLECTION_REPORT_JSON),
  listCampaigns: () => parseCampaignList(LIST_JSON),
  listVisits: () => ({ from: "2026-10-06", to: "2026-10-06", items: [] }),
};
const edu = (path: "programmes" | "students" | "students/new" | "students/import" | "students/[studentId]" | "students/[studentId]/edit" | "admissions" | "admissions/new" | "admissions/[admissionId]" | "announcements" | "announcements/new" | "fees" | "fees/pending" | "fees/plans" | "fees/plans/new" | "fees/plans/[planId]" | "fees/plans/[planId]/edit" | "fees/students/[studentId]" | "fees/receipt/[entryId]", params: Record<string, string> = {}, query: Record<string, string> = {}) => async () => {
  const loaders = {
    programmes: () => import("@/app/app/tenants/[tenantId]/programmes/page"),
    students: () => import("@/app/app/tenants/[tenantId]/students/page"),
    "students/new": () => import("@/app/app/tenants/[tenantId]/students/new/page"),
    "students/import": () => import("@/app/app/tenants/[tenantId]/students/import/page"),
    "students/[studentId]": () => import("@/app/app/tenants/[tenantId]/students/[studentId]/page"),
    "students/[studentId]/edit": () => import("@/app/app/tenants/[tenantId]/students/[studentId]/edit/page"),
    admissions: () => import("@/app/app/tenants/[tenantId]/admissions/page"),
    "admissions/new": () => import("@/app/app/tenants/[tenantId]/admissions/new/page"),
    "admissions/[admissionId]": () => import("@/app/app/tenants/[tenantId]/admissions/[admissionId]/page"),
    announcements: () => import("@/app/app/tenants/[tenantId]/announcements/page"),
    "announcements/new": () => import("@/app/app/tenants/[tenantId]/announcements/new/page"),
    fees: () => import("@/app/app/tenants/[tenantId]/fees/page"),
    "fees/pending": () => import("@/app/app/tenants/[tenantId]/fees/pending/page"),
    "fees/plans": () => import("@/app/app/tenants/[tenantId]/fees/plans/page"),
    "fees/plans/new": () => import("@/app/app/tenants/[tenantId]/fees/plans/new/page"),
    "fees/plans/[planId]": () => import("@/app/app/tenants/[tenantId]/fees/plans/[planId]/page"),
    "fees/plans/[planId]/edit": () => import("@/app/app/tenants/[tenantId]/fees/plans/[planId]/edit/page"),
    "fees/students/[studentId]": () => import("@/app/app/tenants/[tenantId]/fees/students/[studentId]/page"),
    "fees/receipt/[entryId]": () => import("@/app/app/tenants/[tenantId]/fees/receipt/[entryId]/page"),
  } as const;
  return ((await loaders[path]()) as unknown as { default: (p: unknown) => Promise<React.ReactElement> }).default(props(params, query));
};
const eduReads = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  getInstitutionProfile: () => parseInstitution(EDU.PROFILE_JSON),
  listProgrammes: () => parseProgrammes(EDU.PROGRAMMES_JSON),
  listContactNames: () => [{ id: EDU.GUARDIAN, name: "Ravi Kumar (synthetic)" }, { id: "22222222-2222-4222-8222-2222222222ab", name: "Lakshmi Devi (synthetic)" }],
  ...over,
});
add({ id: "programmes-education", roles: ["owner", "sales"], render: edu("programmes"), handlers: (role) => ({ ...school(role), ...eduReads() }) });
add({ id: "programmes-education-new", roles: ["owner"], render: edu("programmes"), handlers: (role) => ({ ...school(role), ...eduReads({ getInstitutionProfile: () => parseInstitution(EDU.PROFILE_NONE_JSON), listProgrammes: () => [] }) }) });
add({ id: "students-education", roles: ["owner", "sales"], render: edu("students", {}, { saved: "1" }), handlers: (role) => ({ ...school(role), ...eduReads({ listStudents: () => parseStudentList(EDU.STUDENT_LIST_JSON) }) }) });
add({ id: "students-education-empty", roles: ["owner"], render: edu("students"), handlers: (role) => ({ ...school(role), ...eduReads({ listStudents: () => parseStudentList({ items: [], next_cursor: null }) }) }) });
add({ id: "students-education-filtered", roles: ["admin"], render: edu("students", {}, { programme: EDU.PROGRAMME, status: "left" }), handlers: (role) => ({ ...school(role), ...eduReads({ listStudents: () => parseStudentList({ items: [EDU.STUDENT_LEFT_JSON], next_cursor: "c1" }) }) }) });
add({ id: "student-new-education", roles: ["owner"], render: edu("students/new"), handlers: (role) => ({ ...school(role), ...eduReads() }) });
add({ id: "student-new-sibling-education", roles: ["admin"], render: edu("students/new", {}, { contact: EDU.GUARDIAN }), handlers: (role) => ({ ...school(role), ...eduReads(), fetchContact: () => ({ id: EDU.GUARDIAN, full_name: "Ravi Kumar (synthetic)" }) }) });
add({ id: "student-edit-education", roles: ["owner"], render: edu("students/[studentId]/edit", { studentId: EDU.STUDENT }), handlers: (role) => ({ ...school(role), ...eduReads({ getStudent: () => parseStudent(EDU.STUDENT_JSON) }) }) });
add({ id: "students-import-education", roles: ["owner"], render: edu("students/import"), handlers: (role) => ({ ...school(role) }) });
const studentRead = (json: unknown) => ({ getStudent: () => parseStudent(json), getGuardianFees: () => parseGuardianFees(EDU.GUARDIAN_FEES_JSON) });
add({ id: "student-detail-education", roles: ["owner", "sales"], render: edu("students/[studentId]", { studentId: EDU.STUDENT }, { saved: "1" }), handlers: (role) => ({ ...school(role), ...studentRead(EDU.STUDENT_JSON) }) });
add({ id: "student-detail-left-education", roles: ["admin"], render: edu("students/[studentId]", { studentId: EDU.STUDENT2 }), handlers: (role) => ({ ...school(role), ...studentRead(EDU.STUDENT_LEFT_JSON) }) });
add({ id: "student-detail-erased-education", roles: ["owner"], render: edu("students/[studentId]", { studentId: EDU.STUDENT2 }), handlers: (role) => ({ ...school(role), ...studentRead(EDU.STUDENT_ERASED_JSON) }) });
add({ id: "fees-education", roles: ["owner", "sales"], render: edu("fees"), handlers: (role) => ({ ...school(role), ...eduCardReads, listFeePlans: () => parseFeePlanList(EDU.PLAN_LIST_JSON), getLateFeesPreview: () => parseLateFeesPreview(EDU.LATE_FEES_JSON) }) });
add({ id: "fees-education-noplans", roles: ["owner"], render: edu("fees"), handlers: (role) => ({ ...school(role), ...eduCardReads, listFeePlans: () => [], getLateFeesPreview: () => parseLateFeesPreview({ ...EDU.LATE_FEES_JSON, count: 0, total_paise: 0, rows: [] }) }) });
add({ id: "fees-pending-education", roles: ["owner", "sales"], render: edu("fees/pending"), handlers: (role) => ({ ...school(role), ...eduReads(), listPending: () => parsePending(EDU.PENDING_JSON) }) });
add({ id: "fees-pending-education-empty", roles: ["owner"], render: edu("fees/pending", {}, { programme: EDU.PROGRAMME }), handlers: (role) => ({ ...school(role), ...eduReads(), listPending: () => parsePending({ items: [], next_cursor: null }) }) });
add({ id: "fee-plans-education", roles: ["owner", "sales"], render: edu("fees/plans"), handlers: (role) => ({ ...school(role), ...eduReads(), listFeePlans: () => parseFeePlanList(EDU.PLAN_LIST_JSON) }) });
add({ id: "fee-plans-education-empty", roles: ["owner"], render: edu("fees/plans"), handlers: (role) => ({ ...school(role), ...eduReads(), listFeePlans: () => [] }) });
add({ id: "fee-plan-new-education", roles: ["owner"], render: edu("fees/plans/new"), handlers: (role) => ({ ...school(role), ...eduReads() }) });
add({ id: "fee-plan-copy-education", roles: ["admin"], render: edu("fees/plans/new", {}, { from: EDU.PLAN }), handlers: (role) => ({ ...school(role), ...eduReads(), getFeePlan: () => parseFeePlan(EDU.PLAN_DETAIL_JSON) }) });
add({ id: "fee-plan-detail-education", roles: ["owner", "sales"], render: edu("fees/plans/[planId]", { planId: EDU.PLAN }, { saved: "1" }), handlers: (role) => ({ ...school(role), ...eduReads(), getFeePlan: () => parseFeePlan(EDU.PLAN_DETAIL_JSON) }) });
add({ id: "fee-plan-detail-free-education", roles: ["owner"], render: edu("fees/plans/[planId]", { planId: EDU.PLAN }), handlers: (role) => ({ ...school(role), ...eduReads(), getFeePlan: () => parseFeePlan({ ...EDU.PLAN_DETAIL_JSON, assigned: 0, late_fee_kind: "per_day", late_fee_paise: 5000, late_fee_cap_paise: 100000 }) }) });
add({ id: "fee-plan-edit-education", roles: ["owner"], render: edu("fees/plans/[planId]/edit", { planId: EDU.PLAN }), handlers: (role) => ({ ...school(role), ...eduReads(), getFeePlan: () => parseFeePlan({ ...EDU.PLAN_DETAIL_JSON, assigned: 0 }) }) });
const feeReads = (statement: unknown = EDU.FEE_STATEMENT_JSON): Record<string, Handler> => ({ getStudentFees: () => parseFeeStatement(statement), getStudentFeeEntries: () => parseFeeEntries(EDU.FEE_ENTRIES_JSON), listFeePlans: () => parseFeePlanList(EDU.PLAN_LIST_JSON) });
add({ id: "fees-student-education", roles: ["owner", "sales"], render: edu("fees/students/[studentId]", { studentId: EDU.STUDENT }), handlers: (role) => ({ ...school(role), ...feeReads() }) });
add({ id: "fees-student-noplan-education", roles: ["owner", "sales"], render: edu("fees/students/[studentId]", { studentId: EDU.STUDENT }), handlers: (role) => ({ ...school(role), ...feeReads({ ...EDU.FEE_STATEMENT_JSON, assignment: null }) }) });
add({ id: "fees-receipt-education", roles: ["owner", "sales"], render: edu("fees/receipt/[entryId]", { entryId: EDU.FEE_PAYMENT }), handlers: (role) => ({ ...school(role), getFeeReceipt: () => parseFeeReceipt(EDU.FEE_RECEIPT_JSON) }) });
add({ id: "admissions-education", roles: ["owner", "sales"], render: edu("admissions", {}, { saved: "1" }), handlers: (role) => ({ ...school(role), ...eduReads({ listAdmissions: () => parseAdmissionList(EDU.ADMISSIONS_JSON) }) }) });
add({ id: "admissions-education-empty", roles: ["owner"], render: edu("admissions"), handlers: (role) => ({ ...school(role), ...eduReads({ listAdmissions: () => parseAdmissionList({ items: [], next_cursor: null }) }) }) });
add({ id: "admission-new-education", roles: ["owner", "sales"], render: edu("admissions/new"), handlers: (role) => ({ ...school(role), ...eduReads() }) });
const admissionRead = (json: unknown): Record<string, Handler> => ({ getAdmission: () => parseAdmissionDetail(json), ...eduReads(), listFeePlans: () => parseFeePlanList(EDU.PLAN_LIST_JSON) });
add({ id: "admission-detail-campus-education", roles: ["owner", "sales"], render: edu("admissions/[admissionId]", { admissionId: EDU.ADMISSION }, { saved: "1" }), handlers: (role) => ({ ...school(role), ...admissionRead(EDU.ADMISSION_DETAIL_JSON) }) });
add({ id: "admission-detail-application-education", roles: ["owner", "sales"], render: edu("admissions/[admissionId]", { admissionId: EDU.ADMISSION }), handlers: (role) => ({ ...school(role), ...admissionRead({ ...EDU.ADMISSION_DETAIL_JSON, stage: "application", events: [...EDU.ADMISSION_DETAIL_JSON.events, { stage: "application", lost_reason: null, at: "2026-10-12T05:00:00+00:00" }] }) }) });
add({ id: "admission-detail-lost-education", roles: ["owner"], render: edu("admissions/[admissionId]", { admissionId: EDU.ADMISSION }), handlers: (role) => ({ ...school(role), ...admissionRead({ ...EDU.ADMISSION_DETAIL_JSON, stage: "lost", lost_reason: "fees", events: [...EDU.ADMISSION_DETAIL_JSON.events, { stage: "lost", lost_reason: "fees", at: "2026-10-13T05:00:00+00:00" }] }) }) });
add({ id: "admission-detail-admitted-education", roles: ["admin"], render: edu("admissions/[admissionId]", { admissionId: EDU.ADMISSION }), handlers: (role) => ({ ...school(role), ...admissionRead({ ...EDU.ADMISSION_DETAIL_JSON, stage: "admitted", student_id: EDU.STUDENT }) }) });
const CAMPAIGN_EVENT = { kind: "event", name: "Parents meeting (synthetic)", message_text: "Hello {{name}}, the parents meeting is on {{due_date}}. {{business}}", call_after_step: null, steps: [{ offset_days: -2, time: "10:00" }] };
const CAMPAIGN_JSON_EVENT = { ...CAMPAIGN_DETAIL_JSON, ...CAMPAIGN_EVENT, issues: undefined, issue_text: undefined, sending_on: undefined, total_amount_paise: 0 };
const campaignsPage = async () => (await import("@/app/app/tenants/[tenantId]/campaigns/page")).default(props({}, { saved: "1" }));
const campaignOf = (tab: string | null, extra: Record<string, string> = {}) => async () => (await import("@/app/app/tenants/[tenantId]/campaigns/[campaignId]/page")).default(props({ campaignId: CAMPAIGN }, { ...(tab ? { tab } : {}), ...extra }));
const campaignReads = (detail: unknown = CAMPAIGN_DETAIL_JSON): Record<string, Handler> => ({ getCampaign: () => parseDetail(detail), listRecipients: () => parseRecipients(RECIPIENTS_JSON), getPreview: () => parsePreview(PREVIEW_JSON), getResults: () => parseResults(RESULTS_JSON) });
add({ id: "campaigns-construction", roles: ["owner", "admin", "sales"], render: campaignsPage, handlers: (role) => ({ ...cons(role), listCampaigns: () => parseCampaignList(LIST_JSON) }) });
add({ id: "campaigns-construction-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/campaigns/page")).default(props({})), handlers: (role) => ({ ...cons(role), listCampaigns: () => parseCampaignList({ items: [], next_cursor: null }) }) });
add({ id: "campaign-new-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/campaigns/new/page")).default(props({})), handlers: (role) => ({ ...cons(role), listTemplates: () => parseTemplates({ templates: [{ id: "7e000000-0000-4000-8000-000000000001", name: "payment_reminder_en", language: "en", purpose: "reminder", status: "approved" }] }) }) });
add({ id: "campaign-new-education", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/campaigns/new/page")).default(props({})), handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(EDUCATION), listTemplates: () => parseTemplates({ templates: [] }) }) });
add({ id: "campaign-edit-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/campaigns/[campaignId]/edit/page")).default(props({ campaignId: CAMPAIGN })), handlers: (role) => ({ ...cons(role), ...campaignReads(), listTemplates: () => parseTemplates({ templates: [] }) }) });
add({ id: "campaign-overview-issues", roles: ["owner", "sales"], render: campaignOf(null), handlers: (role) => ({ ...cons(role), ...campaignReads(DETAIL_ISSUES_JSON) }) });
add({ id: "campaign-audience", roles: ["owner", "sales"], render: campaignOf("audience"), handlers: (role) => ({ ...cons(role), ...campaignReads() }) });
add({ id: "campaign-approve", roles: ["owner", "sales"], render: campaignOf("approve"), handlers: (role) => ({ ...cons(role), ...campaignReads() }) });
add({ id: "campaign-approve-issues", roles: ["owner"], render: campaignOf("approve"), handlers: (role) => ({ ...cons(role), ...campaignReads(DETAIL_ISSUES_JSON), getPreview: () => parsePreview(PREVIEW_ISSUES_JSON) }) });
add({ id: "campaign-results", roles: ["owner", "admin"], render: campaignOf("results"), handlers: (role) => ({ ...cons(role), ...campaignReads(DETAIL_RUNNING_JSON) }) });
add({ id: "call-list-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/call-list/page")).default(props({})), handlers: (role) => ({ ...cons(role), getCallList: () => parseCallList(CALL_LIST_JSON) }) });
add({ id: "call-list-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/call-list/page")).default(props({}, { tab: "done" })), handlers: (role) => ({ ...cons(role), getCallList: () => parseCallList({ items: [], next_cursor: null }) }) });
add({ id: "settings-fields-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "fields" })), handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(CONSTRUCTION), listCustomFields: fieldsOf(CONSTRUCTION) }) });
add({ id: "settings-fields-not-saved-yet", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "fields", fieldnote: "unavailable" })), handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(CONSTRUCTION), listCustomFields: () => { throw new ApiRequestError(404, "not_found", "x"); } }) });
add({ id: "customers-new-education", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/customers/new/page")).default(props({})), handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(EDUCATION), listCustomFields: fieldsOf(EDUCATION) }) });
add({ id: "catalogue-new-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/catalogue/new/page")).default(props({})), handlers: (role) => ({ ...base(role), getWorkspacePack: packOf(CONSTRUCTION), listCustomFields: fieldsOf(CONSTRUCTION) }) });
add({ id: "office-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/office/page")).default(props({})), handlers: (role) => ({ ...base(role), getAgentsStatus: () => agentsStatus(), getWorkspacePack: packOf(CONSTRUCTION) }) });
add({ id: "whatsapp-second-step", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/whatsapp/page")).default(props({})), handlers: (role) => ({ ...waHandlers(role, { configured: false, status: "none" }), listTemplates: () => parseTemplates({ templates: [] }), getAccountSecurity: SECURITY_FIRST_LEVEL }) });


// ---- building materials (job CO): the screens of a business that sells by area, weight or piece, delivers in trips and bills on credit --------------------------------------------------------------------
const cons = (role: Role): Record<string, Handler> => ({ ...base(role), getWorkspacePack: packOf(CONSTRUCTION), listCustomFields: fieldsOf(CONSTRUCTION), getCatalogueCustom: () => ({ product_type: "paver_block", size: "200x100 mm", thickness_mm: 80, colour: "grey", gst_rate_percent: 18, hsn_code: "68101990", pieces_per_area: 4.5, pieces_per_pallet: 500 }) });
const leadSide: Record<string, Handler> = { fetchLead: () => parsePage("leads", { items: [LEAD_JSON], next_cursor: null }).items[0], fetchLeadContactId: () => CONTACT, fetchContact: () => parsePage("contacts", { items: [CONTACT_JSON], next_cursor: null }).items[0], fetchCompany: () => parsePage("companies", { items: [COMPANY_JSON], next_cursor: null }).items[0] };
const materialRequirement = parseRequirementView(
  requirementJson("confirmed", {
    fields: [
      { id: "m1", line_no: 1, field_key: "product_type", value: { code: "paver_block", int_value: null, date_value: null, text: null, basis: null }, display: "paver block", certainty: "stated", state: "confirmed", conflict: false, created_via: "agent", quote: "paver blocks", quote_start: 5, quote_end: 17, decided_by: null, decided_at: null },
      { id: "m2", line_no: 1, field_key: "area", value: { code: null, int_value: 100000, date_value: null, text: null, basis: "sq_ft" }, display: "1,000 sq ft", certainty: "stated", state: "confirmed", conflict: false, created_via: "agent", quote: "1,000 sq ft", quote_start: 18, quote_end: 29, decided_by: null, decided_at: null },
      { id: "m3", line_no: null, field_key: "site_location", value: { code: null, int_value: null, date_value: null, text: "Kukatpally", basis: null }, display: "Kukatpally", certainty: "stated", state: "confirmed", conflict: false, created_via: "agent", quote: "Kukatpally", quote_start: 40, quote_end: 50, decided_by: null, decided_at: null },
      { id: "m4", line_no: null, field_key: "laying", value: { code: "no", int_value: null, date_value: null, text: null, basis: null }, display: "Laying not needed", certainty: "stated", state: "confirmed", conflict: false, created_via: "agent", quote: "no laying", quote_start: 51, quote_end: 60, decided_by: null, decided_at: null },
    ],
    confirmable: false, ready_for_quote: true, flags: [], questions: [],
  }),
);
const materialEnquiry = parseEnquiry({ id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need paver blocks 1,000 sq ft for a driveway at Kukatpally. No laying.", truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null });
const itemRead = () => parseMaterialItem(MATERIAL_ITEM_JSON);
const quoteSide2 = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({ getMaterialPolicy: () => parseMaterialPolicy(MATERIAL_POLICY_JSON), listMaterialItems: () => parseMaterialItemList(MATERIAL_LIST_JSON), listMaterialQuotes: () => parseMaterialQuoteList(QUOTE_LIST_JSON), listSites: () => parseSiteList(SITE_LIST_JSON), ...leadSide, ...extra });

add({ id: "products-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/materials/page")).default(props({})), handlers: (role) => ({ ...cons(role), listMaterialItems: () => parseMaterialItemList(MATERIAL_LIST_JSON) }) });
add({ id: "product-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/materials/[itemId]/page")).default(props({ itemId: MATERIAL_ITEM_JSON.id }, { saved: "1" })), handlers: (role) => ({ ...cons(role), getMaterialItem: itemRead }) });
add({ id: "product-construction-incomplete", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/materials/[itemId]/page")).default(props({ itemId: ITEM_BARE_JSON.id })), handlers: (role) => ({ ...cons(role), getMaterialItem: () => parseMaterialItem(ITEM_BARE_JSON), getCatalogueCustom: () => ({}) }) });
add({ id: "product-edit-construction", roles: ["owner", "admin"], render: async () => (await import("@/app/app/tenants/[tenantId]/materials/[itemId]/edit/page")).default(props({ itemId: MATERIAL_ITEM_JSON.id })), handlers: (role) => ({ ...cons(role), getMaterialItem: itemRead }) });
add({ id: "quotes-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => ({ ...cons(role), ...quoteSide2() }) });
add({ id: "quote-rules-construction", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/quote-policy/page")).default(props({})), handlers: (role) => ({ ...cons(role), getMaterialPolicy: () => parseMaterialPolicy(MATERIAL_POLICY_JSON) }) });
add({ id: "quote-rules-construction-none", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/quote-policy/page")).default(props({})), handlers: (role) => ({ ...cons(role), getMaterialPolicy: () => parseMaterialPolicy({ current: null, versions: [] }) }) });
const quotePage = (id: string, quote: object, roles: readonly Role[], search: Record<string, string> = {}, aal?: "aal1" | "aal2") =>
  add({ id, roles, aal, render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/[quoteId]/page")).default(props({ quoteId: MATERIAL_QUOTE }, search)), handlers: (role) => ({ ...cons(role), getMaterialQuote: () => parseMaterialQuoteDetail(quote), getSite: () => parseSite(SITE_JSON), ...leadSide }) });
quotePage("quote-construction-draft", QUOTE_DETAIL_JSON, ["owner", "admin", "sales", "viewer"], { made: "1" });
quotePage("quote-construction-flagged", QUOTE_FLAGGED_JSON, ["owner", "admin"]);
quotePage("quote-construction-approved", QUOTE_APPROVED_JSON, ["owner"]);
quotePage("quote-construction-no-second-factor", QUOTE_DETAIL_JSON, ["owner"], {}, "aal1");
add({ id: "quote-construction-print", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/[quoteId]/print/page")).default(props({ quoteId: MATERIAL_QUOTE })), handlers: (role) => ({ ...cons(role), getMaterialQuote: () => parseMaterialQuoteDetail(QUOTE_APPROVED_JSON), getSite: () => parseSite(SITE_JSON), ...leadSide }) });
add({ id: "enquiry-construction-request", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/enquiries/[enquiryId]/page")).default(props({ enquiryId: ENQ }, {})), handlers: (role) => ({ ...cons(role), fetchEnquiry: () => materialEnquiry, fetchRequirement: () => materialRequirement }) });
add({ id: "enquiry-construction-quote", roles: ["owner", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/enquiries/[enquiryId]/quote/page")).default(props({ enquiryId: ENQ })), handlers: (role) => ({ ...cons(role), fetchEnquiry: () => materialEnquiry, fetchRequirement: () => materialRequirement, ...quoteSide2() }) });
add({ id: "enquiry-construction-no-rules", roles: ["owner", "admin"], render: async () => (await import("@/app/app/tenants/[tenantId]/enquiries/[enquiryId]/quote/page")).default(props({ enquiryId: ENQ })), handlers: (role) => ({ ...cons(role), fetchEnquiry: () => materialEnquiry, fetchRequirement: () => materialRequirement, ...quoteSide2({ getMaterialPolicy: () => parseMaterialPolicy({ current: null, versions: [] }) }) }) });

add({ id: "sites-construction", roles: ["owner", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/sites/page")).default(props({}, { saved: "1" })), handlers: (role) => ({ ...cons(role), listSites: () => parseSiteList(SITE_LIST_JSON), ...leadSide }) });
add({ id: "sites-construction-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/sites/page")).default(props({})), handlers: (role) => ({ ...cons(role), listSites: () => parseSiteList({ items: [], next_cursor: null }) }) });
add({ id: "site-new-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/sites/new/page")).default(props({}, { company: COMPANY })), handlers: (role) => ({ ...cons(role), ...leadSide }) });
add({ id: "site-edit-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/sites/[siteId]/page")).default(props({ siteId: SITE_ID })), handlers: (role) => ({ ...cons(role), getSite: () => parseSite(SITE_JSON), ...leadSide }) });

const material_order = { ...ORDER_JSON, quote_id: null, material_quote_id: MATERIAL_QUOTE, site_id: SITE_ID, state: "advance_paid" };
add({ id: "orders-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/page")).default(props({})), handlers: (role) => ({ ...cons(role), fetchOrders: () => parseOrderPage({ items: [material_order, { ...material_order, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", order_no: 8, state: "quote_approved" }], next_cursor: null }) }) });
add({ id: "order-construction-deliveries", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/[orderId]/page")).default(props({ orderId: ORDER })), handlers: (role) => ({ ...cons(role), fetchOrder: () => parseOrderDetail({ ...DETAIL_JSON, ...material_order }), fetchMembers: () => parseMembers(MEMBERS_JSON), listOrderTrips: () => parseTripList(TRIP_LIST_JSON) }) });
add({ id: "trips-construction", roles: ["owner", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/trips/page")).default(props({}, { date: "2026-10-20", saved: "1" })), handlers: (role) => ({ ...cons(role), listTrips: () => parseTripList({ items: [...TRIP_LIST_JSON.items, { ...TRIP_ON_THE_WAY_JSON, id: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3", trip_no: 3, status: "problem", problem_code: "site_closed" }] }), listSites: () => parseSiteList(SITE_LIST_JSON) }) });
add({ id: "trips-construction-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/trips/page")).default(props({})), handlers: (role) => ({ ...cons(role), listTrips: () => parseTripList({ items: [] }), listSites: () => parseSiteList({ items: [], next_cursor: null }) }) });
add({ id: "trip-construction", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/trips/[tripId]/page")).default(props({ tripId: TRIP_ID })), handlers: (role) => ({ ...cons(role), getTrip: () => parseTripDetail(TRIP_DETAIL_JSON), getSite: () => parseSite(SITE_JSON) }) });
add({ id: "challan-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/trips/[tripId]/challan/page")).default(props({ tripId: TRIP_ID })), handlers: (role) => ({ ...cons(role), getChallan: () => parseChallan(CHALLAN_JSON) }) });
const planSide = (role: Role): Record<string, Handler> => ({ ...cons(role), fetchOrder: () => parseOrderDetail({ ...DETAIL_JSON, ...material_order }), getMaterialQuote: () => parseMaterialQuoteDetail(QUOTE_APPROVED_JSON), listOrderTrips: () => parseTripList({ items: [] }), getMaterialPolicy: () => parseMaterialPolicy(MATERIAL_POLICY_JSON), ...leadSide, listSites: () => parseSiteList(SITE_LIST_JSON) });
add({ id: "trip-plan-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/orders/[orderId]/trips/new/page")).default(props({ orderId: ORDER })), handlers: planSide });

add({ id: "dues-construction", roles: ["owner", "sales", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/dues/page")).default(props({})), handlers: (role) => ({ ...cons(role), getLedgerSummary: () => parseLedgerSummary(LEDGER_SUMMARY_JSON) }) });
add({ id: "dues-construction-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/dues/page")).default(props({})), handlers: (role) => ({ ...cons(role), getLedgerSummary: () => parseLedgerSummary({ items: [], next_cursor: null }) }) });
add({ id: "dues-customer-construction", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/dues/[companyId]/page")).default(props({ companyId: LEDGER_COMPANY })), handlers: (role) => ({ ...cons(role), getLedgerStatement: () => parseLedgerStatement(STATEMENT_JSON), getLedgerEntries: () => parseLedgerEntries(ENTRIES_JSON), ...leadSide }) });
add({ id: "dues-receipt-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/dues/receipt/[entryId]/page")).default(props({ entryId: ENTRY_PAYMENT })), handlers: (role) => ({ ...cons(role), getLedgerReceipt: () => parseLedgerReceipt(RECEIPT_JSON) }) });
add({ id: "product-new-construction", roles: ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/materials/new/page")).default(props({})), handlers: (role) => ({ ...cons(role) }) });
add({ id: "announcements-education", roles: ["owner", "sales"], render: edu("announcements"), handlers: (role) => ({ ...school(role), listCampaigns: () => parseCampaignList({ items: [{ ...CAMPAIGN_JSON_EVENT }], next_cursor: null }) }) });
add({ id: "announcements-education-empty", roles: ["owner"], render: edu("announcements"), handlers: (role) => ({ ...school(role), listCampaigns: () => parseCampaignList({ items: [], next_cursor: null }) }) });
add({ id: "announcement-new-education", roles: ["owner"], render: edu("announcements/new"), handlers: (role) => ({ ...school(role), listTemplates: () => parseTemplates({ templates: [{ id: "7e000000-0000-4000-8000-000000000001", name: "parents_notice_en", language: "en", purpose: "reminder", status: "approved" }] }) }) });
const eduCampaign = (json: unknown): Record<string, Handler> => ({ getCampaign: () => parseDetail(json), listRecipients: () => parseRecipients(RECIPIENTS_JSON), listProgrammes: () => parseProgrammes(EDU.PROGRAMMES_JSON) });
add({ id: "campaign-audience-announcement-education", roles: ["owner"], render: campaignOf("audience"), handlers: (role) => ({ ...school(role), ...eduCampaign({ ...CAMPAIGN_DETAIL_JSON, ...CAMPAIGN_EVENT }) }) });
add({ id: "campaign-audience-fees-education", roles: ["owner"], render: campaignOf("audience"), handlers: (role) => ({ ...school(role), ...eduCampaign({ ...CAMPAIGN_DETAIL_JSON, kind: "fee_due" }) }) });
const reportPage = async () => (await import("@/app/app/tenants/[tenantId]/report/page")).default(props({}));
add({ id: "report-construction", roles: ["owner", "admin"], render: reportPage, handlers: (role) => ({ ...reportHandlers(role), getWorkspacePack: packOf(CONSTRUCTION), getReportCatalogue: () => parseCatalogue(RPT.CATALOGUE_CONSTRUCTION_JSON) }) });
add({ id: "report-education", roles: ["owner"], render: reportPage, handlers: (role) => ({ ...reportHandlers(role), getWorkspacePack: packOf(EDUCATION), getReportCatalogue: () => parseCatalogue(RPT.CATALOGUE_EDUCATION_JSON) }) });
const runPage = (code: string, query: Record<string, string> = {}) => async () => (await import("@/app/app/tenants/[tenantId]/report/[code]/page")).default(props({ code }, query));
const run = (catalogue: unknown, json: unknown, pack: () => unknown = packOf(CONSTRUCTION)) => (role: Role): Record<string, Handler> => ({ ...base(role), getWorkspacePack: pack as Handler, getReportCatalogue: () => parseCatalogue(catalogue), runReport: () => parseReport(json) });
add({ id: "report-run-quotes", roles: ["owner", "sales"], render: runPage("construction.quotes"), handlers: run(RPT.CATALOGUE_CONSTRUCTION_JSON, RPT.QUOTES_REPORT_JSON) });
add({ id: "report-run-revenue", roles: ["owner"], render: runPage("construction.revenue_by_product", { from: "2026-09-15", to: "2026-10-14" }), handlers: run(RPT.CATALOGUE_CONSTRUCTION_JSON, RPT.REVENUE_REPORT_JSON) });
add({ id: "report-run-trips", roles: ["owner"], render: runPage("construction.trips_per_day"), handlers: run(RPT.CATALOGUE_CONSTRUCTION_JSON, RPT.TRIPS_REPORT_JSON) });
add({ id: "report-run-dues", roles: ["owner"], render: runPage("construction.dues_ageing"), handlers: run(RPT.CATALOGUE_CONSTRUCTION_JSON, RPT.DUES_REPORT_JSON) });
add({ id: "report-run-top-customers", roles: ["admin"], render: runPage("construction.top_customers"), handlers: run(RPT.CATALOGUE_CONSTRUCTION_JSON, RPT.TOP_CUSTOMERS_REPORT_JSON) });
add({ id: "report-run-collection", roles: ["owner"], render: runPage("education.collection"), handlers: run(RPT.CATALOGUE_EDUCATION_JSON, EDU.COLLECTION_REPORT_JSON, packOf(EDUCATION)) });
add({ id: "report-run-today", roles: ["owner"], render: runPage("education.today"), handlers: run(RPT.CATALOGUE_EDUCATION_JSON, EDU.TODAY_REPORT_JSON, packOf(EDUCATION)) });
add({ id: "report-run-funnel", roles: ["admin"], render: runPage("education.funnel"), handlers: run(RPT.CATALOGUE_EDUCATION_JSON, EDU.FUNNEL_REPORT_JSON, packOf(EDUCATION)) });
