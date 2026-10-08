import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import { ENQ, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";
import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchEnquiry = vi.fn();
const fetchRequirement = vi.fn();
const fetchOrders = vi.fn();
const fetchLeadFollowup = vi.fn();
const fetchLeadContactId = vi.fn();
const quotesApi = { fetchQuoteSetup: vi.fn(), fetchEnquiryQuotes: vi.fn(), fetchQuote: vi.fn(), fetchQuoteText: vi.fn() };

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/enquiries")>()), fetchEnquiry: (...a: unknown[]) => fetchEnquiry(...a), fetchRequirement: (...a: unknown[]) => fetchRequirement(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchOrders: (...a: unknown[]) => fetchOrders(...a) }));
vi.mock("@/lib/api/followups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/followups")>()), fetchLeadFollowup: (...a: unknown[]) => fetchLeadFollowup(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));
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
const CONTACT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const props = (query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ tenantId: TENANT, enquiryId: ENQ }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof EnquiryPage>[0];
const enquiry = {
  id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00", subject: null, body: "Need 20 kanjivaram sarees.",
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
};
const view = { requirement: { id: "66666666-6666-4666-8666-666666666666", status: "confirmed", created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" }, fields: [], lines: [], confirmable: true, ready_for_quote: true, flags: [], questions: [] };
const approved = (over: object = {}) => parseQuote({ ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00", ...over });
const open = { channel: "whatsapp", channels: [], gate: { blocked: null, stopped: null, policy_in_force: true } };
const show = async (query: Record<string, string> = {}) => render(await EnquiryPage(props(query)));

describe("the WhatsApp controls on /app/tenants/[tenantId]/enquiries/[enquiryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T06:00:00Z"));
    vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
    fetchOrders.mockResolvedValue({ items: [], next_cursor: null });
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "sales" });
    fetchEnquiry.mockResolvedValue(enquiry);
    fetchRequirement.mockResolvedValue(view);
    quotesApi.fetchQuoteSetup.mockResolvedValue(parseSetup(SETUP_JSON));
    quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary({ ...SUMMARY_JSON, outcome: "approved", status: "approved" })]);
    quotesApi.fetchQuote.mockResolvedValue(approved());
    quotesApi.fetchQuoteText.mockResolvedValue(parseQuoteText(TEXT_JSON));
    fetchLeadFollowup.mockResolvedValue(open);
    fetchLeadContactId.mockResolvedValue(CONTACT);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("an approved quote shows Copy text and Open in WhatsApp next to each other, and the page holds no number or wa.me address", async () => {
    const { container } = await show();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", expect.stringMatching(/^\/app\/tenants\/[0-9a-f-]{36}\/quotes\/[0-9a-f-]{36}\/whatsapp$/));
    expect(container.innerHTML).not.toMatch(/wa\.me/);
    expect(fetchLeadFollowup).toHaveBeenCalledWith("tok", TENANT, LEAD, "whatsapp");
  });

  it("asks nothing about WhatsApp for a draft, a rejected, a withdrawn or a superseded quote, and shows no controls", async () => {
    for (const outcome of ["draft", "rejected", "withdrawn", "superseded"]) {
      vi.clearAllMocks();
      quotesApi.fetchQuoteSetup.mockResolvedValue(parseSetup(SETUP_JSON));
      quotesApi.fetchEnquiryQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
      quotesApi.fetchQuote.mockResolvedValue(parseQuote({ ...QUOTE_JSON, outcome }));
      fetchOrders.mockResolvedValue({ items: [], next_cursor: null });
      const { unmount } = await show();
      expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
      expect(fetchLeadFollowup).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("an expired approved quote keeps Copy text, hides Open in WhatsApp and does not read the gate", async () => {
    quotesApi.fetchQuote.mockResolvedValue(approved({ valid_until: "2026-10-07" }));
    await show();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(screen.getByText(/This quote expired after 2026-10-07/)).toBeInTheDocument();
    expect(fetchLeadFollowup).not.toHaveBeenCalled();
  });

  it("a blocked channel shows the sentence for the database's word, and for consent a link to that person's consent page", async () => {
    fetchLeadFollowup.mockResolvedValue({ ...open, gate: { blocked: "consent", stopped: null, policy_in_force: true } });
    await show();
    expect(screen.getByText(/no recorded WhatsApp consent/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Record consent for this person/ })).toHaveAttribute("href", `/app/tenants/${TENANT}/contacts/${CONTACT}/consent`);
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
  });

  it("a gate that cannot be read does not take the page down: Copy text stays, WhatsApp is not offered", async () => {
    fetchLeadFollowup.mockRejectedValue(new Error("down"));
    await show();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
    expect(screen.getByText(/WhatsApp could not be prepared right now/)).toBeInTheDocument();
  });

  it("a session that expires while reading the gate goes to the login page", async () => {
    fetchLeadFollowup.mockRejectedValue(new ApiAuthError());
    expect(await redirectTarget(() => show())).toBe("/login");
  });

  it("the code the redirect sent the person back with is shown as our sentence; an unknown code is ignored", async () => {
    await show({ whatsapp: "not_from_here" });
    expect(screen.getByRole("alert", { name: "" })).toBeDefined();
    expect(screen.getByText(/the click did not come from this page/)).toBeInTheDocument();
  });

  it("an unknown or hostile whatsapp value shows nothing", async () => {
    await show({ whatsapp: "<img src=x onerror=alert(1)>" });
    expect(screen.queryByText(/click did not come/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toBeInTheDocument();
  });

  it("a text that is too long for a link offers the chat alone", async () => {
    quotesApi.fetchQuoteText.mockResolvedValue(parseQuoteText({ ...TEXT_JSON, text: "₹".repeat(300) }));
    await show();
    expect(screen.getByRole("link", { name: "Open the WhatsApp chat" })).toHaveAttribute("href", expect.stringMatching(/\/whatsapp\?chat=1$/));
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
  });

  it("without a follow-up policy the page says so beside the controls", async () => {
    fetchLeadFollowup.mockResolvedValue({ ...open, gate: { blocked: null, stopped: null, policy_in_force: false } });
    await show();
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/No follow-up policy is in force/)).toBeInTheDocument();
  });

  it("the 'I sent it on WhatsApp' button is on the page beside Open in WhatsApp, with the page's id for this render", async () => {
    const { container } = await show();
    expect(screen.getByRole("button", { name: "I sent it on WhatsApp" })).toBeInTheDocument();
    expect(container.querySelector('input[name="touch_id"]')).toHaveValue("77777777-7777-4777-8777-777777777777");
  });

  it("the button is not offered when the channel is blocked, the quote expired or the gate unread", async () => {
    fetchLeadFollowup.mockResolvedValue({ ...open, gate: { blocked: "key", stopped: null, policy_in_force: true } });
    const first = await show();
    expect(screen.queryByRole("button", { name: "I sent it on WhatsApp" })).toBeNull();
    first.unmount();
    fetchLeadFollowup.mockRejectedValue(new Error("down"));
    const second = await show();
    expect(screen.queryByRole("button", { name: "I sent it on WhatsApp" })).toBeNull();
    second.unmount();
    quotesApi.fetchQuote.mockResolvedValue(approved({ valid_until: "2026-10-07" }));
    await show();
    expect(screen.queryByRole("button", { name: "I sent it on WhatsApp" })).toBeNull();
  });

  it("when the text could not be prepared there are no WhatsApp controls and no gate read", async () => {
    quotesApi.fetchQuoteText.mockRejectedValue(new Error("down"));
    await show();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(fetchLeadFollowup).not.toHaveBeenCalled();
  });
});
