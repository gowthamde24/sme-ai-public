import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseQuote, parseQuoteSummary, parseSetup } from "@/lib/api/quotes";
import { ENQ, P1, QUOTE, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON } from "@/lib/api/quotes-fixtures";

vi.mock("./quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined),
  createQuoteAction: vi.fn(async () => undefined),
  pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined),
  withdrawQuoteAction: vi.fn(async () => undefined),
}));

import { QuotePanel } from "./quote-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const setup = (over: object = {}) => parseSetup({ ...SETUP_JSON, ...over });
const picked = (over: object = {}) =>
  setup({ lines: [{ ...SETUP_JSON.lines[0], pick: { product_id: P1, qty: 20, sale_unit: "piece", source: "manual" } }, SETUP_JSON.lines[1]], ...over });

function panel(over: Partial<Parameters<typeof QuotePanel>[0]> = {}) {
  return render(
    <QuotePanel
      tenantId={TENANT}
      enquiryId={ENQ}
      role="sales"
      secondFactorMissing={false}
      setup={setup()}
      quotes={[]}
      selected={null}
      text={null}
      textError={null}
      newQuoteId="77777777-7777-4777-8777-777777777777"
      {...over}
    />,
  );
}

describe("QuotePanel", () => {
  it("says up front that nothing is sent and that prices are never typed", () => {
    panel();
    expect(screen.getByText(/draft until an owner or admin approves it/)).toBeInTheDocument();
    expect(screen.getByText(/never from a person or an assistant/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing on this page is ever sent to anyone/)).toBeInTheDocument();
  });

  it("with a requirement that is not approved there is nothing to pick and a reason is given", () => {
    panel({ setup: setup({ requirement_status: "draft", missing: ["requirement_not_confirmed"] }) });
    expect(screen.getByText("Approve the requirement first.")).toBeInTheDocument();
    expect(screen.queryByText("1. Choose the product for each line")).toBeNull();
    expect(screen.queryByRole("button", { name: /Make draft quote/ })).toBeNull();
  });

  it("with no price list or policy it says an owner has to publish one, and there is no Prices or Policy page to send them to", () => {
    panel({ setup: setup({ price_list_version_id: null, policy_version_id: null, missing: ["no_price_list", "no_policy"], price_list: [] }) });
    expect(screen.getByText(/no price list in force/)).toBeInTheDocument();
    expect(screen.getByText(/no quote policy in force/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("1. Choose the product for each line")).toBeNull();
  });

  it("a ready requirement shows a pick form per quoted line, names the lines it does not quote, and holds back the draft form until every line has a product", () => {
    panel();
    expect(screen.getByText("1. Choose the product for each line")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this product" })).toHaveLength(1); // line 1 only
    expect(screen.getByText(/Not quoted/)).toBeInTheDocument();
    expect(screen.getByText("Line 2: Saree type: Banarasi (not confirmed)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make draft quote" })).toBeNull();
    expect(screen.getByText("Choose a product for every line above first.")).toBeInTheDocument();
  });

  it("once every quoted line has a product the draft form appears", () => {
    panel({ setup: picked() });
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change the product" })).toBeInTheDocument();
  });

  it("mentions that a new draft replaces the current one, and offers the earlier quotes by link", () => {
    const quotes = [parseQuoteSummary(SUMMARY_JSON), parseQuoteSummary({ ...SUMMARY_JSON, id: "99999999-9999-4999-8999-999999999990", quote_no: 2, status: "rejected", outcome: "rejected" })];
    panel({ setup: picked(), quotes, selected: parseQuote(QUOTE_JSON) });
    expect(screen.getByText("Making a new draft replaces the current draft.")).toBeInTheDocument();
    const earlier = screen.getByRole("link", { name: "Quote 2" });
    expect(earlier).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${ENQ}?quote=99999999-9999-4999-8999-999999999990`);
    expect(screen.getByRole("link", { name: "Quote 3" })).toHaveAttribute("aria-current", "true");
  });

  it("shows the selected draft with its decisions and no customer text", () => {
    panel({ role: "owner", setup: picked(), quotes: [parseQuoteSummary(SUMMARY_JSON)], selected: parseQuote(QUOTE_JSON) });
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this quote" })).toBeInTheDocument();
    expect(screen.queryByText("Text for the customer")).toBeNull();
  });

  it("shows the customer text of an approved quote with the copy button and the notice", () => {
    const approved = parseQuote({ ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" });
    panel({ role: "owner", quotes: [parseQuoteSummary({ ...SUMMARY_JSON, status: "approved", outcome: "approved" })], selected: approved, text: { ...TEXT_JSON, sent_by_system: false } });
    expect(screen.getByText("Text for the customer")).toBeInTheDocument();
    expect(screen.getByLabelText("Quote text for the customer").textContent).toContain("Grand total: ₹79,859.00");
    expect(screen.getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent by the system/)).toBeInTheDocument();
    expect(screen.getByText("Withdraw this approved quote")).toBeInTheDocument();
  });

  it("when the text cannot be prepared the approval stands and the screen says nothing was sent", () => {
    const approved = parseQuote({ ...QUOTE_JSON, status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00" });
    panel({ role: "owner", selected: approved, text: null, textError: "quote_text_unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("The approval stands");
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was sent");
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
  });

  it("a withdrawn quote shows no customer text and no copy button", () => {
    const withdrawn = parseQuote({ ...QUOTE_JSON, status: "superseded", outcome: "withdrawn", withdrawn_at: "2026-10-06T07:00:00+00:00", withdraw_code: "other" });
    panel({ role: "owner", selected: withdrawn, quotes: [parseQuoteSummary({ ...SUMMARY_JSON, status: "superseded", outcome: "withdrawn" })] });
    expect(screen.queryByText("Text for the customer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    expect(QUOTE).toBeTruthy();
  });
});
