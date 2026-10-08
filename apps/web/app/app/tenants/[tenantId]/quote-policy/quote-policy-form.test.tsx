import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QuotePolicyState } from "./quote-policy-actions";
import { FIELD_TEXT, publishRefusal } from "./quote-policy-logic";
import { QuotePolicyForm } from "./quote-policy-form";

// Every number in this file is a SYNTHETIC placeholder for a test, not a suggestion and not the family's policy.
const ID_A = "55555555-5555-4555-8555-555555555555";
const ID_B = "66666666-6666-4666-8666-666666666666";
const TODAY = "2026-10-08";
const MIN = "2026-10-12";
const SAVED: QuotePolicyState = { ok: true, message: "Published version 3, starting on 20 Oct 2026." };
type Fn = (prev: QuotePolicyState, data: FormData) => Promise<QuotePolicyState>;
const mk = (result: QuotePolicyState = SAVED) => vi.fn<Fn>(async () => result);
const renderForm = (action: Fn, id = ID_A, minDate = MIN) => render(<QuotePolicyForm action={action} policyId={id} today={TODAY} minDate={minDate} />);

const LABELS = {
  effective_from: /^Starts on$/,
  validity_days: /^Days a quote is valid$/,
  new_advance: /^Advance for a new customer/,
  repeat_advance: /^Advance for a repeat customer/,
  new_net_days: /^New customers \(days\)$/,
  repeat_net_days: /^Repeat customers \(days\)$/,
  credit_limit: /^Most credit for one repeat customer/,
  seller_state: /^State where the shop is/,
  discount_ceiling: /^Discount ceiling/,
} as const;
type Name = keyof typeof LABELS;
const GOOD: Record<Name, string> = {
  effective_from: "2026-10-20",
  validity_days: "7",
  new_advance: "50",
  repeat_advance: "25.5",
  new_net_days: "10",
  repeat_net_days: "45",
  credit_limit: "2500.50",
  seller_state: "XX",
  discount_ceiling: "0",
};
const NAMES = Object.keys(LABELS) as Name[];
const field = (name: Name) => screen.getByLabelText(LABELS[name]) as HTMLInputElement;
const fill = (values: Partial<Record<Name, string>>) => {
  for (const [name, value] of Object.entries(values)) fireEvent.change(field(name as Name), { target: { value } });
};
const fillAll = (over: Partial<Record<Name, string>> = {}) => fill({ ...GOOD, ...over });
const submit = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Publish this version|Publishing/ })));
const hidden = (c: HTMLElement) => (c.querySelector('input[name="policy_id"]') as HTMLInputElement).value;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assertInternalLinks = (c: HTMLElement) => {
  for (const a of Array.from(c.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    expect(href, href).toMatch(/^\/app(\/|$)/);
    expect(href).not.toMatch(/[:\\]|\/\//);
  }
};

describe("QuotePolicyForm: every field starts empty and nothing is selected", () => {
  it("has nine empty, required fields and no select, radio or checkbox", () => {
    const { container } = renderForm(mk());
    for (const name of NAMES) {
      expect(field(name), name).toHaveValue("");
      expect(field(name), name).toBeRequired();
    }
    expect(container.querySelectorAll("select, input[type=radio], input[type=checkbox], textarea")).toHaveLength(0);
  });
  it("the start date cannot be earlier than the page's own minimum", () => {
    renderForm(mk());
    expect(field("effective_from")).toHaveAttribute("min", MIN);
    expect(field("effective_from")).toHaveAttribute("type", "date");
  });
  it("shipping is not an input: it is one read-only line, and no field is named for shipping, tax, rounding or required inputs", () => {
    const { container } = renderForm(mk());
    expect(screen.getByText("Shipping: none (no courier charge)")).toBeInTheDocument();
    const names = Array.from(container.querySelectorAll("input")).map((i) => i.getAttribute("name"));
    expect(names.sort()).toEqual(["discount_ceiling", "effective_from", "new_advance", "new_net_days", "policy_id", "repeat_advance", "repeat_net_days", "credit_limit", "seller_state", "validity_days"].sort());
    expect(names.join(" ")).not.toMatch(/shipping|tax|rounding|required|gst/i);
  });
  it("says in one sentence that there is no GST rate, price range or last-price warning yet", () => {
    renderForm(mk());
    expect(screen.getByText("This page does not have a GST rate, a price range for each item type or a last-price warning yet. GST on a manual price is added at 5 % until a later change.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/GST/i)).toBeNull();
    expect(screen.queryByLabelText(/price range|last price/i)).toBeNull();
  });
  it("the discount ceiling hint says what the ceiling does today", () => {
    renderForm(mk());
    expect(screen.getByText("The most discount, in percent, that a quote line may carry; today no quote line carries a discount, so this number is saved with the policy but changes no quote.")).toBeInTheDocument();
  });
  it("shows no number, e-mail or address of a person", () => {
    const { container } = renderForm(mk());
    expect(container.textContent).not.toMatch(/@|\+\d{2}|\d{10}/);
  });
});

describe("QuotePolicyForm: a missing or wrong value blocks the save", () => {
  it("with nothing typed the action is not called and the first field's sentence is shown", async () => {
    const action = mk();
    renderForm(action);
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_TEXT.effective_from);
  });
  it.each(NAMES.map((n) => [n]))("with only %s missing the action is not called and that field's sentence is shown", async (name) => {
    const action = mk();
    renderForm(action);
    fillAll({ [name]: "" });
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_TEXT[name]);
  });
  it("the form turns the browser's own validation off, so every refusal is a sentence of ours", () => {
    const { container } = renderForm(mk());
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
  });
  it.each([
    ["effective_from", "2026-10-07"],
    ["validity_days", "0"],
    ["validity_days", "366"],
    ["new_advance", "100.01"],
    ["new_advance", "12.345"],
    ["repeat_advance", "1e3"],
    ["new_net_days", "181"],
    ["repeat_net_days", "181"],
    ["credit_limit", "10000000.01"],
    ["credit_limit", "1,000"],
    ["seller_state", "xx"],
    ["seller_state", "XXX"],
    ["discount_ceiling", "٥٠"],
    ["discount_ceiling", "-1"],
  ] as [Name, string][])("%s = %j: the action is not called and the field's sentence is shown", async (name, value) => {
    const action = mk();
    renderForm(action);
    fillAll({ [name]: value });
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_TEXT[name]);
  });
  it("a wrong value keeps everything the person typed", async () => {
    renderForm(mk());
    fillAll({ new_advance: "12.345" });
    await submit();
    for (const name of NAMES) expect(field(name).value, name).toBe(name === "new_advance" ? "12.345" : GOOD[name]);
  });
});

describe("QuotePolicyForm: what is submitted", () => {
  it("calls the action once with the page's id and the nine fields exactly as typed, and nothing about shipping", async () => {
    const action = mk();
    renderForm(action);
    fillAll({ validity_days: " 7 " });
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect(data.get("policy_id")).toBe(ID_A);
    for (const name of NAMES) expect(data.get(name), name).toBe(name === "validity_days" ? " 7 " : GOOD[name]);
    expect([...data.keys()].filter((k) => /shipping|tax|rounding|required/.test(k))).toEqual([]);
  });
  it("the edges pass the form's own check: zero, the maximum and a start date of today", async () => {
    const action = mk();
    renderForm(action, ID_A, TODAY);
    fillAll({ effective_from: TODAY, validity_days: "365", new_advance: "0", repeat_advance: "100", new_net_days: "180", repeat_net_days: "0", credit_limit: "10000000", discount_ceiling: "100" });
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("while it is publishing, the button says so and the fields are off", async () => {
    let release!: (v: QuotePolicyState) => void;
    const action = vi.fn<Fn>(() => new Promise((resolve) => (release = resolve)));
    renderForm(action);
    fillAll();
    await submit();
    expect(screen.getByRole("button", { name: "Publishing..." })).toBeDisabled();
    expect(field("new_net_days")).toBeDisabled();
    expect(field("repeat_net_days")).toBeDisabled();
    await act(async () => release(SAVED));
    expect(screen.getByRole("button", { name: "Publish this version" })).toBeEnabled();
  });
});

describe("QuotePolicyForm: one id per page render, and a retry is the same press", () => {
  it("the id is the page's id", () => {
    const { container } = renderForm(mk());
    expect(hidden(container)).toBe(ID_A);
  });
  it("a refusal keeps the id and the values, so pressing again is a retry with the same id", async () => {
    const action = mk({ ok: false, error: "Could not publish this. Try again." });
    renderForm(action);
    fillAll();
    await submit();
    await submit();
    expect(action).toHaveBeenCalledTimes(2);
    expect([action.mock.calls[0][1].get("policy_id"), action.mock.calls[1][1].get("policy_id")]).toEqual([ID_A, ID_A]);
    for (const name of NAMES) expect(field(name).value, name).toBe(GOOD[name]);
  });
  it("after a saved version the form is empty with a FRESH id, and the next press sends the new id", async () => {
    const action = mk();
    const { container } = renderForm(action);
    fillAll();
    await submit();
    for (const name of NAMES) expect(field(name).value, name).toBe("");
    const fresh = hidden(container);
    expect(fresh).toMatch(UUID);
    expect(fresh).not.toBe(ID_A);
    fillAll({ validity_days: "10" });
    await submit();
    expect(action.mock.calls[1][1].get("policy_id")).toBe(fresh);
  });
  it("a new id from the page restarts the form: empty fields and the new id", async () => {
    const action = mk({ ok: false, error: "Could not publish this. Try again." });
    const { container, rerender } = renderForm(action);
    fillAll();
    await submit();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<QuotePolicyForm action={action} policyId={ID_B} today={TODAY} minDate={MIN} />);
    for (const name of NAMES) expect(field(name).value, name).toBe("");
    expect(hidden(container)).toBe(ID_B);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("the page's re-render after a saved version (a new id) does not hide the success sentence", async () => {
    const action = mk();
    const { rerender } = renderForm(action);
    fillAll();
    await submit();
    rerender(<QuotePolicyForm action={action} policyId={ID_B} today={TODAY} minDate={MIN} />);
    expect(screen.getByRole("status")).toHaveTextContent("Published version 3, starting on 20 Oct 2026.");
  });
});

describe("QuotePolicyForm: the sentences", () => {
  it("the success sentence names the version and the start date, and stays until the next press", async () => {
    const action = mk();
    renderForm(action);
    fillAll();
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent("Published version 3, starting on 20 Oct 2026.");
    fillAll({ validity_days: "10" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    action.mockResolvedValueOnce({ ok: false, error: "Could not publish this. Try again." });
    await submit();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it.each([
    [403, "forbidden"],
    [422, "validation_error"],
    [422, "invalid_value"],
    [409, "conflict"],
    [429, "http_error"],
    [503, "quotes_unavailable"],
    [500, "anything"],
  ])("%i %s: shows the refusal sentence it was given and no link", async (status, code) => {
    const refusal = publishRefusal(status, code);
    const { container } = renderForm(mk({ ok: false, ...refusal }));
    fillAll();
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(refusal.error);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
  it("a missing second factor links to the Security page, and only that", async () => {
    const refusal = publishRefusal(403, "mfa_required");
    const { container } = renderForm(mk({ ok: false, ...refusal }));
    fillAll();
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(refusal.error);
    expect(screen.getByRole("link", { name: "Open the Security page →" })).toHaveAttribute("href", "/app/security");
    assertInternalLinks(container);
  });
  it("the form's own sentence replaces a server refusal for the same press, and never carries the second-factor link", async () => {
    const action = mk(publishRefusalState());
    const { container } = renderForm(action);
    fillAll();
    await submit();
    expect(container.querySelectorAll("a")).toHaveLength(1);
    fillAll({ new_advance: "12.345" });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_TEXT.new_advance);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
  it("every link in the form is an internal path", async () => {
    const { container } = renderForm(mk(publishRefusalState()));
    assertInternalLinks(container);
    fillAll();
    await submit();
    assertInternalLinks(container);
  });
});

function publishRefusalState(): QuotePolicyState {
  return { ok: false, ...publishRefusal(403, "mfa_required") };
}
