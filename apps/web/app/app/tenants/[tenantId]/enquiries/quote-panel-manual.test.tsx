import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseItemTypes, sellableItemTypes } from "@/lib/api/item-types";
import { parseQuote, parseQuoteSummary, parseQuoteText, parseSetup } from "@/lib/api/quotes";
import { ENQ, MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TEXT_JSON, TYPE_A_JSON, TYPE_B_JSON } from "@/lib/api/quotes-fixtures";

vi.mock("./quote-actions", () => ({
  approveQuoteAction: vi.fn(async () => undefined),
  createQuoteAction: vi.fn(async () => undefined),
  pickProductAction: vi.fn(async () => undefined),
  rejectQuoteAction: vi.fn(async () => undefined),
  withdrawQuoteAction: vi.fn(async () => undefined),
}));
vi.mock("./manual-quote-actions", () => ({ createManualQuoteAction: vi.fn(async () => undefined) }));

import { QuotePanel, type ManualQuoteData } from "./quote-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const ID = "77777777-7777-4777-8777-777777777777";
const typed: ManualQuoteData = { unavailable: false, itemTypes: sellableItemTypes(parseItemTypes([TYPE_A_JSON, TYPE_B_JSON])), gst: { rateBps: 500, from: "2026-10-01" }, newQuoteId: ID };
const approvedManual = { status: "approved", outcome: "approved", approved_at: "2026-10-06T06:00:00+00:00", approved_by: "55555555-5555-4555-8555-555555555555" };

function panel(over: Partial<Parameters<typeof QuotePanel>[0]> = {}) {
  return render(
    <QuotePanel
      tenantId={TENANT}
      enquiryId={ENQ}
      role="owner"
      secondFactorMissing={false}
      setup={parseSetup(SETUP_JSON)}
      quotes={[]}
      selected={null}
      text={null}
      textError={null}
      newQuoteId={ID}
      {...over}
    />,
  );
}

describe("the typed-price form on the quote panel", () => {
  it("is shown when the page passes it (owner and admin) and says prices may be typed", () => {
    panel({ manual: typed });
    expect(screen.getByRole("heading", { name: /typed prices/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make draft quote", hidden: false })).toBeInTheDocument();
    expect(screen.getByText(/or are typed by an owner or an admin/)).toBeInTheDocument();
    expect(screen.queryByText(/never from a person or an assistant/)).toBeNull();
  });
  it("is not there when the page passes nothing (sales, viewer): the old sentence stays", () => {
    panel({ role: "sales" });
    expect(screen.queryByRole("heading", { name: /typed prices/ })).toBeNull();
    expect(screen.queryByLabelText(/Price per piece/)).toBeNull();
    expect(screen.getByText(/never from a person or an assistant/)).toBeInTheDocument();
  });
  it("says the item types or the policy could not be loaded, and shows no form, when the page could not read them", () => {
    panel({ manual: { unavailable: true } });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByLabelText(/Price per piece/)).toBeNull();
  });
  it("with no GST rate in force the button is off and the reason is given", () => {
    panel({ manual: { ...typed, gst: null } });
    expect(screen.getByText("A quote with typed prices needs a quote policy in force with a GST rate that applies today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeDisabled();
  });
  it("the list form is still there beside it when the list path is ready", () => {
    panel({ manual: typed, setup: parseSetup({ ...SETUP_JSON, lines: [{ ...SETUP_JSON.lines[0], pick: { product_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", qty: 20, sale_unit: "piece", source: "manual" } }, SETUP_JSON.lines[1]] }) });
    expect(screen.getByText("1. Choose the product for each line")).toBeInTheDocument();
    expect(screen.getByText(/Or make a quote with typed prices/)).toBeInTheDocument();
  });
});

describe("a typed-price quote on the panel", () => {
  it("shows its lines by item type name, the decisions, and no list wording", () => {
    panel({ selected: parseQuote(MANUAL_QUOTE_JSON), quotes: [parseQuoteSummary(MANUAL_SUMMARY_JSON)] });
    expect(screen.getByRole("heading", { name: "Quote 4" })).toBeInTheDocument();
    expect(screen.getAllByText("Price typed by a person")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve this quote" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/LINE-\d/);
    expect(screen.getByText(/or are typed by an owner or an admin/)).toBeInTheDocument();
  });
  it("keeps the approve, reject and withdraw buttons and the second-factor prompt", () => {
    panel({ selected: parseQuote(MANUAL_QUOTE_JSON), quotes: [parseQuoteSummary(MANUAL_SUMMARY_JSON)], secondFactorMissing: true });
    expect(screen.getByText(/Approving needs your authenticator app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
  });
  it("an admin sees that a flagged typed-price quote is the owner's alone", () => {
    const flagged = parseQuote({ ...MANUAL_QUOTE_JSON, review_flags: ["TYPED_PRICE_OUTSIDE_RANGE"], needs_owner_approval: true });
    panel({ role: "admin", selected: flagged, quotes: [parseQuoteSummary(MANUAL_SUMMARY_JSON)] });
    expect(screen.getByText(/only the owner can approve it/)).toBeInTheDocument();
  });
  it("after approval the API's text is shown to copy, exactly as it came", () => {
    const text = parseQuoteText({ ...TEXT_JSON, text: "Approved quote\nType A\n3 x ₹2,500.00\n- GST as applicable at invoicing" });
    panel({ selected: parseQuote({ ...MANUAL_QUOTE_JSON, ...approvedManual }), quotes: [parseQuoteSummary({ ...MANUAL_SUMMARY_JSON, outcome: "approved", status: "approved" })], text });
    const copy = screen.getByRole("heading", { name: "Text for the customer" }).parentElement as HTMLElement;
    const shown = (screen.getByLabelText("Quote text for the customer") as HTMLElement).textContent ?? "";
    expect(shown).toBe("Approved quote\nType A\n3 x ₹2,500.00\n- GST as applicable at invoicing");
    expect(shown).toContain("Approved quote");
    expect(shown).toContain("- GST as applicable at invoicing");
    expect(shown).toContain("3 x ₹2,500.00");
    expect(within(copy).queryByText(/LINE-/)).toBeNull();
  });
  it("earlier quotes are marked when their prices were typed", () => {
    const list = [parseQuoteSummary(MANUAL_SUMMARY_JSON), parseQuoteSummary({ ...SUMMARY_JSON, id: "88888888-8888-4888-8888-888888888880", quote_no: 2 })];
    panel({ selected: parseQuote(MANUAL_QUOTE_JSON), quotes: list });
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items.find((t) => t.includes("Quote 4"))).toContain("typed prices");
    expect(items.find((t) => t.includes("Quote 2"))).not.toContain("typed prices");
  });
});

describe("a list-price quote on the panel", () => {
  it("is untouched: its sentence, its sku and requirement line, its delivery", () => {
    panel({ role: "sales", selected: parseQuote(QUOTE_JSON), quotes: [parseQuoteSummary(SUMMARY_JSON)] });
    expect(screen.getByText(/never from a person or an assistant/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("SYN-K; requirement line 1");
    expect(screen.queryByText("Price typed by a person")).toBeNull();
  });
});
