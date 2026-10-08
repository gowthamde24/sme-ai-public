import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItemTypes } from "@/lib/api/item-types";
import { parseQuotePolicyVersions } from "@/lib/api/quote-policies";
import { ENQ, MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON, TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";
import { parseQuote, parseQuoteSummary, parseSetup, parseQuoteText } from "@/lib/api/quotes";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchEnquiry = vi.fn();
const fetchRequirement = vi.fn();
const ordersApi = { fetchOrders: vi.fn() };
const itemTypesApi = { fetchItemTypes: vi.fn() };
const policiesApi = { fetchQuotePolicyVersions: vi.fn() };
const quotesApi = { fetchQuoteSetup: vi.fn(), fetchEnquiryQuotes: vi.fn(), fetchQuote: vi.fn(), fetchQuoteText: vi.fn() };

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/enquiries")>()),
  fetchEnquiry: (...a: unknown[]) => fetchEnquiry(...a),
  fetchRequirement: (...a: unknown[]) => fetchRequirement(...a),
}));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchOrders: (...a: unknown[]) => ordersApi.fetchOrders(...a) }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/quotes")>()),
  fetchQuoteSetup: (...a: unknown[]) => quotesApi.fetchQuoteSetup(...a),
  fetchEnquiryQuotes: (...a: unknown[]) => quotesApi.fetchEnquiryQuotes(...a),
  fetchQuote: (...a: unknown[]) => quotesApi.fetchQuote(...a),
  fetchQuoteText: (...a: unknown[]) => quotesApi.fetchQuoteText(...a),
}));
vi.mock("@/lib/api/item-types", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/item-types")>()), fetchItemTypes: (...a: unknown[]) => itemTypesApi.fetchItemTypes(...a) }));
vi.mock("@/lib/api/quote-policies", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quote-policies")>()), fetchQuotePolicyVersions: (...a: unknown[]) => policiesApi.fetchQuotePolicyVersions(...a) }));
vi.mock("../manual-quote-actions", () => ({ createManualQuoteAction: vi.fn(async () => undefined) }));
vi.mock("../actions", () => ({
  captureEnquiryAction: vi.fn(async () => undefined), extractRequirementAction: vi.fn(async () => undefined), decideFieldAction: vi.fn(async () => undefined),
  addFieldAction: vi.fn(async () => undefined), confirmRequirementAction: vi.fn(async () => undefined), discardRequirementAction: vi.fn(async () => undefined),
}));
vi.mock("../quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined), createQuoteAction: vi.fn(async () => undefined), pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined), withdrawQuoteAction: vi.fn(async () => undefined),
}));

import EnquiryPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "33333333-3333-3333-3333-333333333333";
const props = (query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ tenantId: TENANT, enquiryId: ENQ }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof EnquiryPage>[0];

const enquiry = {
  id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 kanjivaram sarees.",
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
};
const view = { requirement: { id: "66666666-6666-4666-8666-666666666666", status: "confirmed", created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" }, fields: [], lines: [], confirmable: true, ready_for_quote: true, flags: [], questions: [] };
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });

async function show(query: Record<string, string> = {}) {
  render(await EnquiryPage(props(query)));
}

const POLICY = {
  id: "55555555-5555-4555-8555-555555555555", version_no: 2, effective_from: "2026-10-01", discount_ceiling_bps: 0, shipping_flat_fee_paise: 0, shipping_free_above_paise: null,
  shipping_tax_bps: 500, validity_days: 15, new_advance_bps: 5000, repeat_advance_bps: 2500, new_net_days: 10, repeat_net_days: 45, gst_rate_bps: 1200, gst_effective_from: "2026-10-01",
  tax_mode: "exclusive", rounding_mode: "half_up", repeat_credit_limit_paise: 0, seller_state: "TG", required_inputs: ["delivery_state"], created_at: "2026-10-01T10:00:00.000000+00:00", in_force: true,
};

describe("the typed-price form on /app/tenants/[tenantId]/enquiries/[enquiryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
    ordersApi.fetchOrders.mockResolvedValue({ items: [], next_cursor: null });
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchEnquiry.mockResolvedValue(enquiry);
    fetchRequirement.mockResolvedValue(view);
    quotesApi.fetchQuoteSetup.mockResolvedValue(parseSetup(SETUP_JSON));
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([]);
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(QUOTE_JSON));
    quotesApi.fetchQuoteText.mockResolvedValue(parseQuoteText(TEXT_JSON));
    itemTypesApi.fetchItemTypes.mockResolvedValue(parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, TYPE_A_JSON]));
    policiesApi.fetchQuotePolicyVersions.mockResolvedValue(parseQuotePolicyVersions([POLICY]));
  });

  it.each(["owner", "admin"])("a %s user gets the form, with the active item types and the policy's GST rate, read with their own token", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    await show();
    expect(itemTypesApi.fetchItemTypes).toHaveBeenCalledWith("tok", TENANT);
    expect(policiesApi.fetchQuotePolicyVersions).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { name: "Quote with typed prices" })).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining(["Choose an item type", "Type A", "Type B"]));
    expect(screen.queryByText("Type C (not sold)")).toBeNull();
    expect(screen.getByText(/GST rate:/).textContent).toContain("12%");
    expect(screen.getByText(/GST rate:/).textContent).toContain("1 Oct 2026");
    expect(document.querySelector('input[name="quote_id"]')).toHaveValue("77777777-7777-4777-8777-777777777777");
  });

  it.each(["sales", "viewer"])("a %s user never sees the form and nothing is asked of the API for it", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    await show();
    expect(itemTypesApi.fetchItemTypes).not.toHaveBeenCalled();
    expect(policiesApi.fetchQuotePolicyVersions).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Quote with typed prices" })).toBeNull();
    expect(screen.queryByLabelText(/Price per piece/)).toBeNull();
  });

  it("with no policy in force, or a rate that starts later, the form says there is no rate and cannot be sent", async () => {
    policiesApi.fetchQuotePolicyVersions.mockResolvedValue(parseQuotePolicyVersions([{ ...POLICY, in_force: false }]));
    await show();
    expect(screen.getByText(/needs a quote policy in force with a GST rate that applies today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeDisabled();
    document.body.innerHTML = "";
    policiesApi.fetchQuotePolicyVersions.mockResolvedValue(parseQuotePolicyVersions([{ ...POLICY, gst_effective_from: "2026-10-07" }]));
    await show();
    expect(screen.getByText(/needs a quote policy in force with a GST rate that applies today/)).toBeInTheDocument();
  });

  it("a rate that starts today is in force", async () => {
    policiesApi.fetchQuotePolicyVersions.mockResolvedValue(parseQuotePolicyVersions([{ ...POLICY, gst_effective_from: "2026-10-06" }]));
    await show();
    expect(screen.getByText(/GST rate:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeEnabled();
  });

  it("when the item types cannot be read the section says so and the rest of the quote screen is unaffected", async () => {
    itemTypesApi.fetchItemTypes.mockRejectedValue(new ApiRequestError(503, "quotes_unavailable", "x"));
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
    await show();
    expect(screen.getByText(/item types or the quote policy could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Price per piece/)).toBeNull();
  });

  it("an expired session on the item types goes to the login page", async () => {
    itemTypesApi.fetchItemTypes.mockRejectedValue(new ApiAuthError("expired"));
    await expect(show()).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("a typed-price quote is selected and shown with its item type names (never LINE-n), and its summary is listed", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(MANUAL_SUMMARY_JSON), parseQuoteSummary(SUMMARY_JSON)]);
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(MANUAL_QUOTE_JSON));
    await show();
    expect(screen.getByRole("heading", { name: "Quote 4" })).toBeInTheDocument();
    expect(screen.getAllByText("Price typed by a person")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/LINE-\d/);
    expect(quotesApi.fetchQuote).toHaveBeenCalledWith("tok", TENANT, MANUAL_QUOTE_JSON.id);
  });

  it("an approved typed-price quote asks for its text and shows the API's text as it is", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary({ ...MANUAL_SUMMARY_JSON, outcome: "approved", status: "approved" })]);
    quotesApi.fetchQuote.mockResolvedValue(parseQuote({ ...MANUAL_QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" }));
    quotesApi.fetchQuoteText.mockResolvedValue(parseQuoteText({ ...TEXT_JSON, text: "Approved quote\nType A\n- GST as applicable at invoicing" }));
    await show();
    expect(quotesApi.fetchQuoteText).toHaveBeenCalledWith("tok", TENANT, MANUAL_QUOTE_JSON.id);
    expect(screen.getByLabelText("Quote text for the customer").textContent).toBe("Approved quote\nType A\n- GST as applicable at invoicing");
  });

  it("a quote whose pricing_kind is missing is a list-price quote and renders as one", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
    await show();
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("SYN-K; requirement line 1");
    expect(screen.queryByText("Price typed by a person")).toBeNull();
  });
});
