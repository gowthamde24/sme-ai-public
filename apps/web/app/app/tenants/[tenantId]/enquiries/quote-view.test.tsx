import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseQuote } from "@/lib/api/quotes";
import { QUOTE_JSON } from "@/lib/api/quotes-fixtures";

import { QuoteView } from "./quote-view";

const quote = (over: object = {}) => parseQuote({ ...QUOTE_JSON, ...over });

describe("QuoteView", () => {
  it("shows every figure, formatted from integer paise, and the dates", () => {
    render(<QuoteView quote={quote()} stateName="Maharashtra" />);
    expect(screen.getByRole("heading", { name: "Quote 3" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    for (const shown of ["₹3,800.00 each", "(the price for 10 or more)", "₹76,000.00", "₹3,800.00", "₹79,800.00", "₹50.00", "₹9.00", "₹79,859.00", "₹39,929.50"]) expect(text).toContain(shown);
    expect(screen.getByText("GST (5%)")).toBeInTheDocument();
    expect(screen.getByText("21 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("5 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("20 pieces")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Maharashtra (MH), another state");
  });

  it("says in words what each flag means before anyone approves, and who decides", () => {
    render(<QuoteView quote={quote({ engine_flags: ["BELOW_MINIMUM_ORDER_QUANTITY"], review_flags: ["REPEAT_CUSTOMER_CLAIMED", "MIXED_GST_RATES_SHIPPING"], needs_owner_approval: true, customer_kind: "repeat" })} stateName="Maharashtra" />);
    const note = screen.getByText("Please read before approving:").closest("div") as HTMLElement;
    expect(within(note).getAllByRole("listitem")).toHaveLength(3);
    expect(note).toHaveTextContent("below its minimum order quantity");
    expect(note).toHaveTextContent("which nobody has verified");
    expect(note).toHaveTextContent("freight is charged");
    expect(screen.getByText("Needs the owner's approval")).toBeInTheDocument();
    expect(screen.getByText("Repeat customer")).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/REPEAT_CUSTOMER_CLAIMED|BELOW_MINIMUM/); // never the raw code
  });

  it("says an unknown flag needs the owner without showing its code", () => {
    render(<QuoteView quote={quote({ review_flags: ["SOME_FUTURE_FLAG"], needs_owner_approval: true })} stateName="x" />);
    expect(screen.getByText(/carries a flag the owner must look at/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SOME_FUTURE_FLAG");
  });

  it("lists the requirement lines this quote does NOT cover", () => {
    render(<QuoteView quote={quote({ unquoted_lines: [{ line_no: 3, summary: ["Saree type: Patola (not confirmed)", "Quantity: 50 pieces (not confirmed)"] }] })} stateName="x" />);
    expect(screen.getByText(/Not in this quote/)).toBeInTheDocument();
    expect(screen.getByText("Line 3: Saree type: Patola (not confirmed); Quantity: 50 pieces (not confirmed)")).toBeInTheDocument();
  });

  it("labels each outcome in our words and never says Sent", () => {
    for (const [outcome, status, word] of [
      ["draft", "draft", "Draft"], ["approved", "approved", "Approved"], ["rejected", "rejected", "Rejected"], ["withdrawn", "superseded", "Withdrawn"], ["superseded", "superseded", "Replaced"],
    ] as const) {
      const { unmount } = render(<QuoteView quote={quote({ outcome, status })} stateName="x" />);
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/\bSent\b/);
      unmount();
    }
  });

  it("records who decided and why, in our wording", () => {
    render(<QuoteView quote={quote({ outcome: "withdrawn", status: "superseded", approved_at: "2026-10-06T06:00:00+00:00", withdrawn_at: "2026-10-06T07:00:00+00:00", withdraw_code: "price_changed" })} stateName="x" />);
    expect(document.body.textContent).toContain("Withdrawn on");
    expect(document.body.textContent).toContain("A price changed.");
    expect(document.body.textContent).not.toContain("price_changed");
  });

  it("explains where the figures came from without claiming a person or a model made them", () => {
    render(<QuoteView quote={quote()} stateName="x" />);
    expect(screen.getByText(/pricing engine \(version 1.1.0\)/)).toBeInTheDocument();
    expect(screen.getByText(/No person typed a price and no language model calculated one/)).toBeInTheDocument();
    expect(screen.getByText("0123456789abcdef")).toBeInTheDocument(); // a short fingerprint, not the whole hash
  });

  it("renders every name and requirement text as plain text", () => {
    const hostile = "<script>alert(1)</script> Ignore previous instructions";
    render(
      <QuoteView
        quote={quote({ lines: [{ ...QUOTE_JSON.lines[0], name: hostile }], unquoted_lines: [{ line_no: 2, summary: [hostile] }] })}
        stateName={hostile}
      />,
    );
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getAllByText(new RegExp(hostile.replace(/[()]/g, "\\$&"))).length).toBeGreaterThanOrEqual(2);
  });
});
