import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseItemTypes, sellableItemTypes } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";

import type { ManualQuoteState } from "./manual-quote-actions";
import { ManualQuoteForm, NO_RATE_TEXT } from "./manual-quote-form";
import { LINE_TEXT, RANGE_NOTE } from "./manual-quote-logic";

const ID = "77777777-7777-4777-8777-777777777777";
const ID2 = "66666666-6666-4666-8666-666666666666";
const STATES = { KA: "Karnataka", TG: "Telangana" };
const TYPES = sellableItemTypes(parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, TYPE_A_JSON]));
type Fn = (prev: ManualQuoteState, data: FormData) => Promise<ManualQuoteState>;
const mk = (result: ManualQuoteState = { ok: true }) => vi.fn<Fn>(async () => result);
const GST = { rateBps: 500, from: "2026-10-01" };

function renderForm(action: Fn, over: Partial<Parameters<typeof ManualQuoteForm>[0]> = {}) {
  return render(<ManualQuoteForm create={action} quoteId={ID} itemTypes={TYPES} gst={GST} states={STATES} {...over} />);
}
const line = (n: number) => ({
  code: screen.getByLabelText(new RegExp(`^Item type$`), { selector: `#mq-code-${n}` }) as HTMLSelectElement,
  qty: document.getElementById(`mq-qty-${n}`) as HTMLInputElement,
  price: document.getElementById(`mq-price-${n}`) as HTMLInputElement,
});
const fillLine = (n: number, code: string, qty: string, price: string) => {
  const l = line(n);
  fireEvent.change(l.code, { target: { value: code } });
  fireEvent.change(l.qty, { target: { value: qty } });
  fireEvent.change(l.price, { target: { value: price } });
};
const submit = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Make draft quote|Making the draft/ })));
const addLine = () => fireEvent.click(screen.getByRole("button", { name: "Add a line" }));

describe("the form", () => {
  it("starts with one empty line, nothing chosen, and says that nothing is sent", () => {
    renderForm(mk());
    expect(screen.getByRole("heading", { name: "Quote with typed prices" })).toBeInTheDocument();
    const l = line(1);
    expect([l.code.value, l.qty.value, l.price.value]).toEqual(["", "", ""]);
    expect(screen.getByText(/Nothing is approved and nothing is sent/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove line/ })).toBeNull();
  });
  it("offers only the item types it is given, by name, after a first empty choice", () => {
    renderForm(mk());
    const options = within(line(1).code).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose an item type", "Type A", "Type B"]);
    expect(screen.queryByText(/not sold/)).toBeNull();
  });
  it("shows the GST rate of the policy as read-only text, not a field", () => {
    renderForm(mk());
    expect(screen.getByText(/GST rate:/).textContent).toContain("5%");
    expect(screen.getByText(/GST rate:/).textContent).toContain("1 Oct 2026");
    expect(screen.queryByLabelText(/GST/i)).toBeNull();
  });
  it("the customer kind starts as a new customer and a repeat customer says the owner decides", () => {
    renderForm(mk());
    expect(screen.getByLabelText("New customer")).toBeChecked();
    expect(screen.getByLabelText("Repeat customer")).not.toBeChecked();
    expect(screen.getByText(/the owner decides such a quote/)).toBeInTheDocument();
  });
});

describe("one to five lines", () => {
  it("adds lines up to five and then the button is off", () => {
    renderForm(mk());
    for (let n = 2; n <= 5; n += 1) {
      addLine();
      expect(document.getElementById(`mq-code-${n}`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Add a line" })).toBeDisabled();
    expect(screen.getByText(/at most 5 lines/)).toBeInTheDocument();
    expect(document.getElementById("mq-code-6")).toBeNull();
  });
  it("removes a line but never the last one, and keeps the others' text", () => {
    renderForm(mk());
    fillLine(1, "A", "3", "2500");
    addLine();
    fillLine(2, "B", "1", "999.99");
    fireEvent.click(screen.getByRole("button", { name: "Remove line 1" }));
    expect(line(1).code.value).toBe("B");
    expect(line(1).price.value).toBe("999.99");
    expect(screen.queryByRole("button", { name: /Remove line/ })).toBeNull();
  });
});

describe("sending", () => {
  it("sends the page's id, the kind, the optional state and every line's own fields, exactly as typed", async () => {
    const action = mk();
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    addLine();
    fillLine(2, "B", "1", "999.99");
    fireEvent.change(screen.getByLabelText("Delivery state (optional)"), { target: { value: "KA" } });
    fireEvent.click(screen.getByLabelText("Repeat customer"));
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect(Object.fromEntries(data.entries())).toEqual({
      quote_id: ID, line_count: "2", customer_kind: "repeat", delivery_state: "KA", code_1: "A", qty_1: "3", price_1: "2500", code_2: "B", qty_2: "1", price_2: "999.99",
    });
  });
  it("a state is not needed", async () => {
    const action = mk();
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    await submit();
    expect(action.mock.calls[0][1].get("delivery_state")).toBe("");
  });
  it.each([
    ["no item type", ["", "3", "2500"], LINE_TEXT.itemType],
    ["no quantity", ["A", "", "2500"], LINE_TEXT.qty],
    ["a quantity of 0", ["A", "0", "2500"], LINE_TEXT.qty],
    ["a price with three decimals", ["A", "3", "1.505"], LINE_TEXT.price],
    ["a price of 0", ["A", "3", "0"], LINE_TEXT.price],
    ["a negative price", ["A", "3", "-1"], LINE_TEXT.price],
    ["a price in words", ["A", "3", "abc"], LINE_TEXT.price],
  ])("%s: the action is not called and the line's own sentence is shown", async (_name, [code, qty, price], sentence) => {
    const action = mk();
    renderForm(action);
    fillLine(1, code, qty, price);
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`Line 1: ${sentence}`);
  });
  it("names the line that is wrong", async () => {
    const action = mk();
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    addLine();
    fillLine(2, "B", "1", "x");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Line 2:");
  });
  it("while it is working, the button says so and the fields are off", async () => {
    let release!: (v: ManualQuoteState) => void;
    const action = vi.fn<Fn>(() => new Promise((resolve) => (release = resolve)));
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    await submit();
    expect(screen.getByRole("button", { name: "Making the draft..." })).toBeDisabled();
    expect(line(1).price).toBeDisabled();
    await act(async () => release({ ok: true }));
  });
});

describe("a retry is the same press", () => {
  it("after a refusal the same id is sent again, and what was typed is still there", async () => {
    const action = vi.fn<Fn>(async () => ({ ok: false, error: "Could not save. Try again." }));
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    await submit();
    await submit();
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[0][1].get("quote_id")).toBe(ID);
    expect(action.mock.calls[1][1].get("quote_id")).toBe(ID);
    expect(line(1).price.value).toBe("2500");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save. Try again.");
  });
  it("a different page render brings its own id", () => {
    const { unmount } = renderForm(mk());
    expect(document.querySelector('input[name="quote_id"]')).toHaveValue(ID);
    unmount();
    renderForm(mk(), { quoteId: ID2 });
    expect(document.querySelector('input[name="quote_id"]')).toHaveValue(ID2);
  });
});

describe("the soft range note", () => {
  it("shows a neutral note under a price outside the item type's range and never stops the form", async () => {
    const action = mk();
    renderForm(action);
    fillLine(1, "B", "2", "4000.01");
    expect(screen.getByRole("note")).toHaveTextContent(RANGE_NOTE);
    expect(screen.queryByRole("alert")).toBeNull();
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][1].get("price_1")).toBe("4000.01");
  });
  it("shows for a price below the range too, per line, and clears when the price is back inside", () => {
    renderForm(mk());
    fillLine(1, "B", "1", "499.99");
    addLine();
    fillLine(2, "B", "1", "500");
    expect(screen.getAllByText(RANGE_NOTE)).toHaveLength(1);
    fireEvent.change(line(1).price, { target: { value: "500" } });
    expect(screen.queryByText(RANGE_NOTE)).toBeNull();
  });
  it("does not show for an item type without a range, before a type is chosen, or for text that is not a price", () => {
    renderForm(mk());
    fillLine(1, "A", "1", "99999");
    expect(screen.queryByText(RANGE_NOTE)).toBeNull();
    fillLine(1, "", "1", "1");
    expect(screen.queryByText(RANGE_NOTE)).toBeNull();
    fillLine(1, "B", "1", "abc");
    expect(screen.queryByText(RANGE_NOTE)).toBeNull();
  });
});

describe("no GST rate in force", () => {
  it("says why in the API's own words, and the button cannot be pressed", async () => {
    const action = mk();
    renderForm(action, { gst: null });
    expect(screen.getByText(NO_RATE_TEXT)).toBeInTheDocument();
    expect(NO_RATE_TEXT).toBe("A quote with typed prices needs a quote policy in force with a GST rate that applies today.");
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeDisabled();
    fillLine(1, "A", "3", "2500");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(action).not.toHaveBeenCalled();
  });
});

describe("refusals from the server", () => {
  it("an enquiry that already has a requirement blocks the form with a clear message and no retry", async () => {
    const message = "This enquiry already has a requirement from the line-by-line flow, so a quote with typed prices cannot be made on it.";
    const action = vi.fn<Fn>(async () => ({ ok: false, blocked: true, error: message }));
    renderForm(action);
    fillLine(1, "A", "3", "2500");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeDisabled();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("any other refusal shows its sentence and the button stays usable", async () => {
    renderForm(vi.fn<Fn>(async () => ({ ok: false, error: "A quantity, a price or a choice was not accepted. Check every line." })));
    fillLine(1, "A", "3", "2500");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("was not accepted");
    expect(screen.getByRole("button", { name: "Make draft quote" })).toBeEnabled();
  });
});

describe("the form never computes anything", () => {
  it("shows no total, no GST amount and no tax figure", () => {
    renderForm(mk());
    fillLine(1, "A", "3", "2500");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/₹/);
    expect(text).not.toMatch(/Total|Line total|Net:/);
  });
});
