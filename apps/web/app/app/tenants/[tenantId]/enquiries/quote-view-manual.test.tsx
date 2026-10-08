import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseQuote } from "@/lib/api/quotes";
import { MANUAL_QUOTE_JSON, QUOTE_JSON } from "@/lib/api/quotes-fixtures";

import { QuoteView } from "./quote-view";

const manual = (over: object = {}) => parseQuote({ ...MANUAL_QUOTE_JSON, ...over });

describe("QuoteView of a quote whose prices a person typed", () => {
  it("shows the item type's name and says the price was typed by a person, and never an internal key", () => {
    render(<QuoteView quote={manual()} stateName="" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Type A");
    expect(text).toContain("Type B");
    expect(screen.getAllByText("Price typed by a person")).toHaveLength(2);
    expect(text).not.toMatch(/LINE-\d/);
    expect(text).not.toContain("requirement line");
    expect(screen.getByText("Typed prices")).toBeInTheDocument();
  });
  it("shows every figure from integer paise and the rate each line used", () => {
    render(<QuoteView quote={manual()} stateName="" />);
    const text = document.body.textContent ?? "";
    for (const shown of ["₹2,500.00 each", "₹7,500.00", "₹375.00", "₹7,875.00", "₹999.99 each", "₹50.00", "₹8,499.99", "₹425.00", "₹8,924.99", "₹4,462.50", "₹4,462.49"]) expect(text, shown).toContain(shown);
    expect(screen.getAllByText("GST (5%)")).toHaveLength(2);
    expect(screen.getByText("3 pieces")).toBeInTheDocument();
    expect(screen.getByText("1 piece")).toBeInTheDocument();
  });
  it("leaves out the list-only rows when they are null: delivery, price list", () => {
    render(<QuoteView quote={manual()} stateName="" />);
    expect(screen.queryByText("Delivery")).toBeNull();
    expect(screen.queryByText("Price list version")).toBeNull();
    expect(document.body.textContent).not.toMatch(/null|undefined|another state|seller's own state/);
    expect(screen.getByText("Policy version")).toBeInTheDocument();
  });
  it("shows the delivery state when the quote was made with one", () => {
    render(<QuoteView quote={manual({ delivery_state: "KA", gst_supply: "inter_state" })} stateName="Karnataka" />);
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Karnataka (KA), another state");
  });
  it("says in the details that a person typed the prices, not that nobody did", () => {
    render(<QuoteView quote={manual()} stateName="" />);
    const details = document.querySelector("details") as HTMLElement;
    expect(details).toHaveTextContent("A person typed the price of each line");
    expect(details).not.toHaveTextContent("No person typed a price");
    expect(details).toHaveTextContent("No language model calculated a price");
  });
  it("shows the out-of-range warning in the same style as the other flags and says the owner decides", () => {
    render(<QuoteView quote={manual({ review_flags: ["TYPED_PRICE_OUTSIDE_RANGE"], needs_owner_approval: true })} stateName="" />);
    const note = screen.getByText("Please read before approving:").closest("div") as HTMLElement;
    expect(within(note).getAllByRole("listitem")).toHaveLength(1);
    expect(note).toHaveTextContent("outside the usual range for its item type");
    expect(screen.getByText("Needs the owner's approval")).toBeInTheDocument();
  });
  it("the repeat-customer flag reads as it does for any quote", () => {
    render(<QuoteView quote={manual({ review_flags: ["REPEAT_CUSTOMER_CLAIMED"], customer_kind: "repeat", needs_owner_approval: true })} stateName="" />);
    expect(screen.getByText(/which nobody has verified/)).toBeInTheDocument();
  });
});

describe("a quote with a missing pricing_kind is a list-price quote", () => {
  it("renders with its sku, its requirement line, its price list and its delivery, and no typed-price wording", () => {
    render(<QuoteView quote={parseQuote(QUOTE_JSON)} stateName="Maharashtra" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("SYN-K; requirement line 1");
    expect(text).toContain("Maharashtra (MH), another state");
    expect(screen.getByText("Price list version")).toBeInTheDocument();
    expect(text).not.toContain("Price typed by a person");
    expect(text).not.toContain("Typed prices");
    expect(text).toContain("No person typed a price and no language model calculated one");
  });
});
