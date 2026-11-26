import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { defaultEmployee, employee, show } from "./fixtures";

vi.mock("next/link", () => import("./link-mock"));

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;
const save = (c: HTMLElement) => within(c).getByRole("button", { name: "Save" });

describe("Rules: what it may do alone", () => {
  it("shows the seven ask-first actions with the ticked ones", async () => {
    show({ initialTab: "rules" });
    const c = await card("What it may do alone");
    const boxes = within(c).getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    expect(within(c).getByRole("checkbox", { name: "Sending a message" })).toBeChecked();
    expect(within(c).getByRole("checkbox", { name: "Giving a discount" })).not.toBeChecked();
    expect(within(c).getAllByRole("switch")).toHaveLength(4);
  });

  it("saves exactly the ask-first list, the switches and the discount that changed", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("What it may do alone");
    expect(save(c)).toBeDisabled();
    fireEvent.click(within(c).getByRole("checkbox", { name: "Giving a discount" }));
    fireEvent.click(within(c).getByRole("checkbox", { name: "Making a call" }));
    fireEvent.click(within(c).getByRole("switch", { name: "Book visits" }));
    fireEvent.change(within(c).getByLabelText("Biggest discount it may give (%)"), { target: { value: "10" } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ askFirst: ["send_message", "give_discount"], autonomy: { mayBookVisits: true, maxDiscountPercent: 10 } }));
    expect(await within(c).findByText("Saved")).toBeInTheDocument();
  });

  it("refuses a discount above 100 without calling the API", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("What it may do alone");
    fireEvent.change(within(c).getByLabelText("Biggest discount it may give (%)"), { target: { value: "101" } });
    fireEvent.click(save(c));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Please check what you wrote and try again.");
    expect(a.patch).not.toHaveBeenCalled();
  });

  it("saves the hand-over rules, with the amount in paise", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Hand over to you");
    fireEvent.click(within(c).getByRole("switch", { name: "When the customer is upset" }));
    fireEvent.change(within(c).getByLabelText("Order above this amount (₹)"), { target: { value: "25000" } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ autonomy: { handoverUpset: false, handoverOrderAbovePaise: 2_500_000 } }));
  });

  it("an empty amount means never", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Hand over to you");
    fireEvent.change(within(c).getByLabelText("Order above this amount (₹)"), { target: { value: "" } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ autonomy: { handoverOrderAbovePaise: null } }));
  });
});

describe("Rules: working hours", () => {
  it("starts as Same as the business and saves null only after a change back", async () => {
    const { a } = show({ initialTab: "rules", employee: employee({ hours: { days: [1, 2], fromMinute: 600, toMinute: 1080 } }) });
    const c = await card("Working hours");
    expect(within(c).getByRole("radio", { name: "Only these hours" })).toBeChecked();
    fireEvent.click(within(c).getByRole("radio", { name: "Same as the business" }));
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ hours: null }));
  });

  it("sends the days and times of Only these hours", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Working hours");
    fireEvent.click(within(c).getByRole("radio", { name: "Only these hours" }));
    fireEvent.click(within(c).getByRole("checkbox", { name: "Sun" }));
    fireEvent.change(within(c).getByLabelText("From"), { target: { value: "11:30" } });
    fireEvent.change(within(c).getByLabelText("To"), { target: { value: "19:00" } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ hours: { days: [1, 2, 3, 4, 5, 6], fromMinute: 690, toMinute: 1140 } }));
  });

  it("never goes wider than 10:00 to 21:00: the sentence is shown and nothing is sent", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Working hours");
    fireEvent.click(within(c).getByRole("radio", { name: "Only these hours" }));
    fireEvent.change(within(c).getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.click(save(c));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Hours must be inside 10:00 to 21:00.");
    fireEvent.change(within(c).getByLabelText("From"), { target: { value: "10:00" } });
    fireEvent.change(within(c).getByLabelText("To"), { target: { value: "22:00" } });
    fireEvent.click(save(c));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Hours must be inside 10:00 to 21:00.");
    expect(a.patch).not.toHaveBeenCalled();
  });

  it("needs a day and a start before the end", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Working hours");
    fireEvent.click(within(c).getByRole("radio", { name: "Only these hours" }));
    fireEvent.change(within(c).getByLabelText("From"), { target: { value: "18:00" } });
    fireEvent.change(within(c).getByLabelText("To"), { target: { value: "12:00" } });
    fireEvent.click(save(c));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Please check what you wrote and try again.");
    expect(a.patch).not.toHaveBeenCalled();
  });

  it("shows the hours_wider answer of the API too", async () => {
    const { a } = show({ initialTab: "rules" });
    a.patch.mockResolvedValueOnce({ ok: false, error: "hours_wider" });
    const c = await card("Working hours");
    fireEvent.click(within(c).getByRole("radio", { name: "Only these hours" }));
    fireEvent.click(save(c));
    expect(await within(c).findByRole("alert")).toHaveTextContent("Hours must be inside 10:00 to 21:00.");
  });
});

describe("Rules: never-say words and instructions", () => {
  it("adds and removes words and saves the list", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Words it must never say");
    fireEvent.change(within(c).getByLabelText("Add a word or phrase"), { target: { value: " cheap " } });
    fireEvent.click(within(c).getByRole("button", { name: "Add" }));
    fireEvent.click(within(c).getByRole("button", { name: "Remove free" }));
    expect(within(c).getByText("1 of 30 words. Each up to 60 letters.")).toBeInTheDocument();
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ neverSay: ["cheap"] }));
  });

  it("stops at 30 words and limits one word to 60 letters", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `w${i}`);
    show({ initialTab: "rules", employee: employee({ neverSay: thirty }) });
    const c = await card("Words it must never say");
    expect(within(c).getByLabelText("Add a word or phrase")).toBeDisabled();
    expect(within(c).getByRole("button", { name: "Add" })).toBeDisabled();
    expect(within(c).getByText("30 of 30 words. Each up to 60 letters.")).toBeInTheDocument();
  });

  it("counts the instructions live and blocks Save over 1500", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Extra instructions");
    expect(within(c).getByText("8 of 1500")).toBeInTheDocument();
    const box = within(c).getByRole("textbox");
    fireEvent.change(box, { target: { value: "x".repeat(1500) } });
    expect(within(c).getByText("1500 of 1500")).toBeInTheDocument();
    expect(save(c)).toBeEnabled();
    fireEvent.change(box, { target: { value: "x".repeat(1501) } });
    expect(within(c).getByText("1501 of 1500")).toBeInTheDocument();
    expect(save(c)).toBeDisabled();
    fireEvent.change(box, { target: { value: "Be brief." } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ extraInstructions: "Be brief." }));
  });

  it("an emptied box clears the instructions with null", async () => {
    const { a } = show({ initialTab: "rules" });
    const c = await card("Extra instructions");
    fireEvent.change(within(c).getByRole("textbox"), { target: { value: "  " } });
    fireEvent.click(save(c));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ extraInstructions: null }));
  });
});

describe("Rules for the main assistant", () => {
  it("shows ask-first, may-do, hand-over and hours read-only with the sentence and the link, but never-say and instructions stay editable", async () => {
    const { a } = show({ initialTab: "rules", employee: defaultEmployee() });
    expect(await screen.findByText(/This AI employee is your main assistant/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open My assistant" })).toHaveAttribute("href", "/app/tenants/t/my-assistant");
    const alone = await card("What it may do alone");
    expect(within(alone).getByRole("checkbox", { name: "Sending a message" })).toBeDisabled();
    expect(within(alone).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(await card("Working hours")).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(await card("Hand over to you")).queryByRole("button", { name: "Save" })).toBeNull();
    const never = await card("Words it must never say");
    fireEvent.change(within(never).getByLabelText("Add a word or phrase"), { target: { value: "cheap" } });
    fireEvent.click(within(never).getByRole("button", { name: "Add" }));
    fireEvent.click(save(never));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ neverSay: ["free", "cheap"] }));
  });
});

describe("Rules for a reader", () => {
  it("shows the values and no Save at all", async () => {
    show({ initialTab: "rules", canEdit: false });
    await card("What it may do alone");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByLabelText("Biggest discount it may give (%)")).toBeDisabled();
  });
});
