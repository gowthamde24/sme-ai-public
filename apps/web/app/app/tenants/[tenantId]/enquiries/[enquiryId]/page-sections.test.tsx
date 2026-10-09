import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ENQ, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";
import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { redirectMock } from "@/test/helpers";

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
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT, enquiryId: ENQ }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof EnquiryPage>[0];
const enquiry = { id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 kanjivaram sarees.", truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null };
const view = { requirement: { id: "66666666-6666-4666-8666-666666666666", status: "confirmed", created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" }, fields: [], lines: [], confirmable: true, ready_for_quote: true, flags: [], questions: [] };
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const approvedJson = { ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" };
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of this enquiry" }));
const current = () => tabs().getByRole("link", { current: "page" }).textContent;

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

describe("the enquiry screen, one part at a time", () => {
  it("opens on the quote once there is one: the quote's figures, and not the customer's text or what comes after approval", async () => {
    render(await EnquiryPage(props()));
    expect(current()).toBe("Quote");
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What the customer wrote" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Text for the customer" })).toBeNull();
  });
  it("opens on the request when there is no quote yet, and offers no Quote tab (there is nothing to show)", async () => {
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([]);
    render(await EnquiryPage(props()));
    expect(current()).toBe("Request");
    expect(screen.getByRole("heading", { name: "What the customer wrote" })).toBeInTheDocument();
    expect(tabs().queryByRole("link", { name: "Quote" })).toBeNull();
    expect(tabs().getByRole("link", { name: "Make a quote" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${ENQ}?section=make`);
  });
  it("Send and order exists only for an approved quote, and then holds the text for the customer and the order", async () => {
    render(await EnquiryPage(props()));
    expect(tabs().queryByRole("link", { name: "Send and order" })).toBeNull();
    cleanup();
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    render(await EnquiryPage(props({ section: "send" })));
    expect(current()).toBe("Send and order");
    expect(screen.getByRole("heading", { name: "Text for the customer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quote 3" })).toBeNull();
  });
  it("a section that is not allowed (send with no approved quote, an unknown word) falls back to where the work is", async () => {
    render(await EnquiryPage(props({ section: "send" })));
    expect(current()).toBe("Quote");
    cleanup();
    render(await EnquiryPage(props({ section: "<script>" })));
    expect(current()).toBe("Quote");
  });
  it("a viewer sees the request only, no tabs, and nothing is asked of the quote API", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await EnquiryPage(props({ section: "quote" })));
    expect(screen.queryByRole("navigation", { name: "Parts of this enquiry" })).toBeNull();
    expect(screen.getByRole("heading", { name: "What the customer wrote" })).toBeInTheDocument();
    for (const fn of Object.values(quotesApi)) expect(fn).not.toHaveBeenCalled();
  });
  it("a WhatsApp return (?whatsapp=) of an approved quote opens Send and order; ?section=all draws every part with no tabs", async () => {
    quotesApi.fetchQuote.mockResolvedValue(parseQuote(approvedJson));
    render(await EnquiryPage(props({ whatsapp: "no-consent" })));
    expect(current()).toBe("Send and order");
    cleanup();
    render(await EnquiryPage(props({ section: "all" })));
    expect(screen.queryByRole("navigation", { name: "Parts of this enquiry" })).toBeNull();
    for (const name of ["What the customer wrote", "Quote 3", "Text for the customer", "Order"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });
});

import { cleanup } from "@testing-library/react";
