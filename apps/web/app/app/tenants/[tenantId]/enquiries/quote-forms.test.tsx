import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSetup } from "@/lib/api/quotes";
import { P1, P2, QUOTE, SETUP_JSON } from "@/lib/api/quotes-fixtures";

import { CopyText } from "./copy-text";
import { CreateQuoteForm } from "./create-quote-form";
import { PickLineForm } from "./pick-line-form";
import { QuoteDecisions } from "./quote-decisions";

const setup = parseSetup(SETUP_JSON);
const line = setup.lines[0];

describe("PickLineForm", () => {
  const ok = () => vi.fn(async () => ({ ok: true as const, message: "Line 1: product chosen." }));

  it("offers the assistant's suggestion first, then the rest of the price list, and chooses nothing", () => {
    render(<PickLineForm pick={ok()} line={line} priceList={setup.price_list} />);
    const select = screen.getByLabelText("Product") as HTMLSelectElement;
    expect(select.value).toBe(""); // nothing is chosen until a person chooses
    const suggested = within(screen.getByRole("group", { name: "Suggested for this line" })).getAllByRole("option");
    expect(suggested.map((o) => (o as HTMLOptionElement).value)).toEqual([`suggested:${P1}:piece`]);
    const rest = within(screen.getByRole("group", { name: "The whole price list" })).getAllByRole("option");
    expect(rest.map((o) => (o as HTMLOptionElement).value)).toEqual([`list:${P2}:piece`]); // the suggested product is not listed twice
    expect(suggested[0]).toHaveTextContent("Synthetic kanjivaram (SYN-K): ₹4,000.00 per piece");
    expect(screen.getByText(/only a suggestion: you choose/)).toBeInTheDocument();
    expect(screen.getByText("No product chosen yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this product" })).toBeEnabled();
  });

  it("starts the quantity at the enquiry's and explains the unit", () => {
    render(<PickLineForm pick={ok()} line={line} priceList={setup.price_list} />);
    expect((screen.getByLabelText("Quantity to quote") as HTMLInputElement).value).toBe("20");
    expect(screen.getByText(/The enquiry asked for 20 piece/)).toBeInTheDocument();
    expect(screen.getByText(/different unit/)).toBeInTheDocument();
  });

  it("shows what is chosen, says who chose it, and offers to change it", () => {
    const picked = { ...line, pick: { product_id: P1, qty: 18, sale_unit: "piece" as const, source: "mapper_suggestion" as const } };
    render(<PickLineForm pick={ok()} line={picked} priceList={setup.price_list} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chosen: Synthetic kanjivaram × 18 piece (from the assistant's suggestion, confirmed by a person)");
    expect((screen.getByLabelText("Product") as HTMLSelectElement).value).toBe(`suggested:${P1}:piece`);
    expect((screen.getByLabelText("Quantity to quote") as HTMLInputElement).value).toBe("18");
    expect(screen.getByRole("button", { name: "Change the product" })).toBeInTheDocument();
  });

  it("sends the person's choice and quantity to the action and shows its outcome", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "That product or quantity was not accepted." }));
    render(<PickLineForm pick={action} line={line} priceList={setup.price_list} />);
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: `list:${P2}:piece` } });
    fireEvent.change(screen.getByLabelText("Quantity to quote"), { target: { value: "5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use this product" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That product or quantity was not accepted."));
    const sent = (action.mock.calls as unknown as [unknown, FormData][])[0][1];
    expect(sent.get("choice")).toBe(`list:${P2}:piece`);
    expect(sent.get("qty")).toBe("5");
  });

  it("renders a hostile product name as text, never as markup", () => {
    const hostile = { ...setup.price_list[0], name: "<img src=x onerror=alert(1)> Boss" };
    render(<PickLineForm pick={ok()} line={line} priceList={[hostile, ...setup.price_list.slice(1)]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> Boss/)).toBeInTheDocument();
  });
});

describe("CreateQuoteForm", () => {
  it("carries the page's id, defaults to a new customer, and lists every state by name", () => {
    render(<CreateQuoteForm create={vi.fn(async () => undefined)} quoteId={QUOTE} states={setup.delivery_states} />);
    expect((document.querySelector('input[name="quote_id"]') as HTMLInputElement).value).toBe(QUOTE);
    expect((screen.getByLabelText("New customer") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Repeat customer") as HTMLInputElement).checked).toBe(false);
    const options = Array.from((screen.getByLabelText("Delivery state") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["", "KA", "MH", "TG"]); // sorted by the state's NAME
    expect((screen.getByLabelText("Delivery state") as HTMLSelectElement).value).toBe(""); // no state is assumed
    expect(screen.getByText(/nobody has verified it, so the owner decides/)).toBeInTheDocument();
    expect(screen.getByText("This makes a draft. Nothing is approved and nothing is sent.")).toBeInTheDocument();
  });

  it("sends the choices and shows the outcome; it has no field for a price", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "Choose the delivery state from the list." }));
    render(<CreateQuoteForm create={action} quoteId={QUOTE} states={setup.delivery_states} />);
    fireEvent.click(screen.getByLabelText("Repeat customer"));
    fireEvent.change(screen.getByLabelText("Delivery state"), { target: { value: "MH" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Make draft quote" })));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const sent = (action.mock.calls as unknown as [unknown, FormData][])[0][1];
    expect([sent.get("quote_id"), sent.get("customer_kind"), sent.get("delivery_state")]).toEqual([QUOTE, "repeat", "MH"]);
    expect(Array.from(sent.keys()).sort()).toEqual(["customer_kind", "delivery_state", "quote_id"]);
    expect(document.querySelector('input[name*="price" i], input[name*="total" i]')).toBeNull();
  });
});

describe("QuoteDecisions", () => {
  const act1 = vi.fn(async () => ({ ok: true as const, message: "Done." }));
  const props = (over: Partial<Parameters<typeof QuoteDecisions>[0]> = {}) => ({
    approve: act1, reject: act1, withdraw: act1, outcome: "draft" as const, role: "owner", needsOwnerApproval: false, secondFactorMissing: false, ...over,
  });
  beforeEach(() => vi.clearAllMocks());

  it("an owner with their authenticator app can approve a draft, and says it sends nothing", () => {
    render(<QuoteDecisions {...props()} />);
    expect(screen.getByRole("button", { name: "Approve this quote" })).toBeEnabled();
    expect(screen.getByText(/does not send anything to the customer/)).toBeInTheDocument();
    expect(screen.getByText("Reject this draft")).toBeInTheDocument();
    expect(screen.queryByText(/Withdraw/)).toBeNull();
  });

  it("an admin cannot approve a flagged quote and is told why; a plain quote is theirs", () => {
    const { unmount } = render(<QuoteDecisions {...props({ role: "admin", needsOwnerApproval: true })} />);
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
    expect(screen.getByText(/only the owner can approve it/)).toBeInTheDocument();
    expect(screen.getByText("Reject this draft")).toBeInTheDocument();
    unmount();
    render(<QuoteDecisions {...props({ role: "admin" })} />);
    expect(screen.getByRole("button", { name: "Approve this quote" })).toBeInTheDocument();
  });

  it("without a second factor the approve button is replaced by the way to set it up", () => {
    render(<QuoteDecisions {...props({ secondFactorMissing: true })} />);
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
    expect(screen.getByRole("link", { name: /Set it up on the Security page/ })).toHaveAttribute("href", "/app/security");
  });

  it("a sales user can only withdraw their own draft", () => {
    render(<QuoteDecisions {...props({ role: "sales" })} />);
    expect(screen.queryByRole("button", { name: "Approve this quote" })).toBeNull();
    expect(screen.getByText("Withdraw my draft", { selector: "summary" })).toBeInTheDocument();
    expect((document.querySelector('input[name="code"]') as HTMLInputElement).value).toBe("withdrawn");
  });

  it("an approved quote can be withdrawn by an owner or admin with a second factor, by nobody else", () => {
    const { unmount } = render(<QuoteDecisions {...props({ outcome: "approved" })} />);
    expect(screen.getByText("Withdraw this approved quote")).toBeInTheDocument();
    expect(Array.from((screen.getByLabelText("Why") as HTMLSelectElement).options).map((o) => o.value)).toEqual(["price_changed", "customer_cancelled", "entered_in_error", "other"]);
    unmount();
    const missing = render(<QuoteDecisions {...props({ outcome: "approved", secondFactorMissing: true })} />);
    expect(screen.queryByLabelText("Why")).toBeNull();
    expect(screen.getByRole("link", { name: /Set it up/ })).toBeInTheDocument();
    missing.unmount();
    const sales = render(<QuoteDecisions {...props({ outcome: "approved", role: "sales" })} />);
    expect(sales.container).toBeEmptyDOMElement();
  });

  it("a rejected, withdrawn or replaced quote has no controls", () => {
    for (const outcome of ["rejected", "withdrawn", "superseded"] as const) {
      const r = render(<QuoteDecisions {...props({ outcome })} />);
      expect(r.container).toBeEmptyDOMElement();
      r.unmount();
    }
  });

  it("shows the outcome of the action it runs", async () => {
    const fail = vi.fn(async () => ({ ok: false as const, error: "Your role does not allow this." }));
    render(<QuoteDecisions {...props({ approve: fail })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve this quote" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your role does not allow this."));
  });
});

describe("CopyText", () => {
  const TEXT = "Approved quote\nGrand total: ₹79,859.00\n<img src=x onerror=alert(1)>";
  it("says nothing is sent by the system and shows the text as plain text", () => {
    render(<CopyText text={TEXT} />);
    expect(screen.getByRole("note")).toHaveTextContent("Nothing is sent by the system. Copy this text and send it yourself");
    const pre = screen.getByLabelText("Quote text for the customer");
    expect(pre.textContent).toBe(TEXT);
    expect(document.querySelector("img")).toBeNull();
    expect(pre.tagName).toBe("PRE");
  });

  it("copies the text and tells the person", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyText text={TEXT} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy text" })));
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(screen.getByRole("status")).toHaveTextContent("Copied. Paste it into your own message.");
  });

  it("says so when the browser refuses to copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    render(<CopyText text={TEXT} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy text" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not copy. Select the text above and copy it yourself.");
  });
});
