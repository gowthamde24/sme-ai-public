import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { ENQ, P1, QUOTE, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";
import { parseOrderPage } from "@/lib/api/orders";
import { ORDER_JSON } from "@/lib/api/orders-fixtures";
import { parseQuote, parseQuoteSummary, parseSetup, parseQuoteText } from "@/lib/api/quotes";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchEnquiry = vi.fn();
const fetchRequirement = vi.fn();
const ordersApi = { fetchOrders: vi.fn() };
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
const OLDER = "99999999-9999-4999-8999-999999999990";
const props = (query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ tenantId: TENANT, enquiryId: ENQ }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof EnquiryPage>[0];

const enquiry = {
  id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 kanjivaram sarees.",
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
};
const view = { requirement: { id: "66666666-6666-4666-8666-666666666666", status: "confirmed", created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" }, fields: [], lines: [], confirmable: true, ready_for_quote: true, flags: [], questions: [] };
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const approvedJson = { ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" };

async function show(query: Record<string, string> = {}) {
  render(await EnquiryPage(props(query)));
}

describe("the quote section of /app/tenants/[tenantId]/enquiries/[enquiryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
    ordersApi.fetchOrders.mockResolvedValue({ items: [], next_cursor: null });
    fetchTenant.mockResolvedValue(tenant("sales"));
    fetchEnquiry.mockResolvedValue(enquiry);
    fetchRequirement.mockResolvedValue(view);
    quotesApi.fetchQuoteSetup.mockResolvedValue(parseSetup(SETUP_JSON));
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(QUOTE_JSON));
    quotesApi.fetchQuoteText.mockResolvedValue(parseQuoteText(TEXT_JSON));
  });

  it("a viewer is never shown a quote and nothing is asked of the API for them", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    await show();
    expect(screen.getByText("Quotes are shown to owners, admins and sales users.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quote" })).toBeNull();
    for (const fn of Object.values(quotesApi)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["sales", "admin", "owner"])("a %s user gets the quote section, read with their own token", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    await show();
    expect(screen.getByRole("heading", { name: "Quote" })).toBeInTheDocument();
    expect(quotesApi.fetchQuoteSetup).toHaveBeenCalledWith("tok", TENANT, ENQ);
    expect(quotesApi.fetchEnquiryQuotes).toHaveBeenCalledWith("tok", TENANT, ENQ);
    expect(quotesApi.fetchQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
  });

  it("shows the newest quote by default, the one asked for with ?quote=, and falls back for an unknown or malformed id", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON), parseQuoteSummary({ ...SUMMARY_JSON, id: OLDER, quote_no: 2 })]);
    await show({ quote: OLDER });
    expect(quotesApi.fetchQuote).toHaveBeenLastCalledWith("tok", TENANT, OLDER);
    for (const wanted of ["99999999-9999-4999-8999-999999999991", "not-a-uuid", "../x"]) {
      quotesApi.fetchQuote.mockClear();
      await show({ quote: wanted });
      expect(quotesApi.fetchQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    }
  });

  it("with no quote yet it asks for none", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([]);
    await show();
    expect(quotesApi.fetchQuote).not.toHaveBeenCalled();
    expect(screen.getByText("1. Choose the product for each line")).toBeInTheDocument();
  });

  it("an approved quote asks for its text and shows it to copy", async () => {
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    await show();
    expect(quotesApi.fetchQuoteText).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    expect(screen.getByLabelText("Quote text for the customer").textContent).toContain("Grand total");
    expect(screen.getByText(/Nothing is sent by the system/)).toBeInTheDocument();
  });

  it("an approved quote asks for ITS order only, by the quote filter and one row, never a page of fifty", async () => {
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    await show();
    expect(ordersApi.fetchOrders).toHaveBeenCalledTimes(1);
    expect(ordersApi.fetchOrders).toHaveBeenCalledWith("tok", TENANT, { quoteId: QUOTE, limit: 1 });
  });

  it("the order the API returns for the quote is linked, and a failing order read does not take the quote down", async () => {
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    ordersApi.fetchOrders.mockResolvedValue(parseOrderPage({ items: [ORDER_JSON], next_cursor: null }));
    await show();
    expect(screen.getByRole("link", { name: "Order 7" })).toBeInTheDocument();
    ordersApi.fetchOrders.mockRejectedValue(new ApiRequestError(503, "orders_unavailable", "x"));
    fetchTenant.mockResolvedValue(tenant("owner"));
    document.body.innerHTML = "";
    await show();
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start order" })).toBeInTheDocument();
  });

  it("a draft does not ask for an order or for text", async () => {
    await show();
    expect(ordersApi.fetchOrders).not.toHaveBeenCalled();
  });

  it("a draft does not ask for text", async () => {
    await show();
    expect(quotesApi.fetchQuoteText).not.toHaveBeenCalled();
  });

  it("when the text is refused the approval still shows, with a fixed sentence and the stable code only", async () => {
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    quotesApi.fetchQuoteText.mockRejectedValue(new ApiRequestError(409, "quote_text_refused", "CANARY-6f2e1d secret data-layer text"));
    await show();
    expect(screen.getByRole("alert")).toHaveTextContent("quote_text_refused");
    expect(document.body.textContent).not.toContain("CANARY-6f2e1d");
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument(); // the quote itself is still shown
  });

  it("a quote screen that cannot load does not take the enquiry down", async () => {
    quotesApi.fetchQuoteSetup.mockRejectedValue(new ApiRequestError(503, "quotes_unavailable", "x"));
    await show();
    expect(screen.getByRole("alert")).toHaveTextContent("The quote could not be loaded right now");
    expect(screen.getByRole("heading", { name: "Enquiry" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requirement" })).toBeInTheDocument();
  });

  it("a contract mismatch in a quote response is an error, not a rendered guess", async () => {
    quotesApi.fetchQuote.mockRejectedValue(new Error("Unexpected total_paise in a quote response."));
    await show();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(document.body.textContent).not.toContain("total_paise");
  });

  it("a session the API rejects goes to the login page", async () => {
    quotesApi.fetchEnquiryQuotes.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(() => EnquiryPage(props()))).toBe("/login");
  });

  it("an owner who has not used their authenticator app is shown how to, instead of an approve button", async () => {
    fetchTenant.mockResolvedValue(tenant("owner"));
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
    await show();
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
    expect(screen.getByRole("link", { name: /Set it up on the Security page/ })).toHaveAttribute("href", "/app/security");
  });

  it("an owner with it can approve; an admin cannot approve a flagged quote; sales cannot approve at all", async () => {
    fetchTenant.mockResolvedValue(tenant("owner"));
    await show();
    expect(screen.getByRole("button", { name: "Approve this quote" })).toBeInTheDocument();
    quotesApi.fetchQuote.mockResolvedValue(parseQuote({ ...QUOTE_JSON, review_flags: ["REPEAT_CUSTOMER_CLAIMED"], needs_owner_approval: true }));
    fetchTenant.mockResolvedValue(tenant("admin"));
    document.body.innerHTML = "";
    await show();
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
    expect(screen.getByText(/only the owner can approve it/)).toBeInTheDocument();
    fetchTenant.mockResolvedValue(tenant("sales"));
    document.body.innerHTML = "";
    await show();
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
  });

  it("makes a fresh id for the next draft on every load", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([]);
    quotesApi.fetchQuoteSetup.mockResolvedValue(parseSetup({ ...SETUP_JSON, lines: [{ ...SETUP_JSON.lines[0], pick: { product_id: P1, qty: 20, sale_unit: "piece", source: "manual" } }] }));
    await show();
    expect((document.querySelector('input[name="quote_id"]') as HTMLInputElement).value).toBe("77777777-7777-4777-8777-777777777777");
  });
});
