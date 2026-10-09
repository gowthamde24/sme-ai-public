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
/** The answer every workspace screen needs first. */
export const base = (role: Role): Record<string, Handler> => ({ fetchTenant: () => tenantOf(role) });

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
// Today: the home with no ?tab= (Job AC, C2). With orders it can count (two open, one cancelled with money held), and with none readable.
add({
  id: "today-with-orders",
  render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, {})),
  handlers: (role) => ({ ...base(role), fetchOrders: () => parseOrders({ items: [ORDER_JSON, { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", order_no: 2, state: "cancelled", outcome: "cancelled", paid_paise: 500000, net_paise: 500000 }], next_cursor: null }), fetchMembers: () => parseMembers(MEMBERS_JSON) }),
});
add({
  id: "today-orders-unreadable",
  roles: ["owner"],
  render: async () => (await import("@/app/app/tenants/[tenantId]/page")).default(props({}, {})),
  handlers: (role) => ({ ...base(role), fetchOrders: () => { throw new ApiRequestError(503, "api_unreachable", "x"); }, fetchMembers: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }),
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
add({ id: "quotes-list", roles: ["owner", "admin", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => ({ ...base(role), fetchQuoteList: () => [parseQuoteSummary(SUMMARY_JSON), parseQuoteSummary(MANUAL_SUMMARY_JSON)] }) });
add({ id: "quotes-empty", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => ({ ...base(role), fetchQuoteList: () => [] }) });
add({ id: "quotes-viewer", roles: ["viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/quotes/page")).default(props({})), handlers: (role) => base(role) });
add({ id: "office-not-available", render: async () => (await import("@/app/app/tenants/[tenantId]/office/page")).default(props({})), handlers: (role) => base(role) });
add({ id: "integrations", render: async () => (await import("@/app/app/tenants/[tenantId]/integrations/page")).default(props({})), handlers: (role) => base(role) });
for (const section of ["business", "language", "security", "privacy"] as const) {
  add({ id: `settings-${section}`, roles: section === "privacy" ? ROLES : ["owner", "sales"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section })), handlers: (role) => base(role) });
}
add({ id: "settings-members", roles: ["owner", "viewer"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "members" })), handlers: (role) => ({ ...base(role), fetchMembers: () => parseMembers(MEMBERS_JSON) }) });
add({ id: "settings-members-unreadable", roles: ["owner"], render: async () => (await import("@/app/app/tenants/[tenantId]/settings/page")).default(props({}, { section: "members" })), handlers: (role) => ({ ...base(role), fetchMembers: () => { throw new ApiRequestError(503, "api_unreachable", "x"); } }) });
