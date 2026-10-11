import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { LEAD_A, slotsJson } from "@/lib/api/visits-fixtures";

import { BookVisit } from "./BookVisit";
import { NOW, TODAY, WORDS, fakeVisitsActions } from "./visits-test-kit";

void NOW;
type Over = Partial<React.ComponentProps<typeof BookVisit>>;
const show = async (over: Over = {}, actions = fakeVisitsActions()) => {
  await act(async () => void render(<BookVisit words={WORDS} lang="en" actions={actions} today={TODAY} start={{ date: TODAY, slot: null }} lead={null} slots={slotsJson(TODAY)} {...over} />));
  return actions;
};
const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const search = async (q: string) => {
  type("Customer", q);
  await click("Search");
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Book a visit: finding the customer", () => {
  it("searches by name (two characters at least), lists the customers found, and a pick is shown with its city", async () => {
    const actions = await show();
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    type("Customer", "S");
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    await search("Sri");
    expect(actions.customers).toHaveBeenCalledWith("Sri");
    await click(/Sri Lakshmi Silks/);
    expect(screen.getByText("Sri Lakshmi Silks, Hyderabad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    await click("Change");
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
  it("says so when nobody has that name, and when the search fails", async () => {
    const customers = vi.fn().mockResolvedValueOnce({ ok: true, items: [] }).mockResolvedValueOnce({ ok: false, error: "That did not work. Nothing was changed. Try again." });
    await show({}, fakeVisitsActions({ customers }));
    await search("Zzz");
    expect(screen.getByRole("status")).toHaveTextContent("No customer found with that name. Add the customer first.");
    await search("Yyy");
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work.");
  });
  it("a lead the person came from is already chosen", async () => {
    await show({ lead: { leadId: LEAD_A, label: "Priya S." } });
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
});

describe("Book a visit: booking", () => {
  const fill = async () => {
    await search("Sri");
    await click(/Sri Lakshmi Silks/);
    await click(/^11:00/);
  };
  it("is not possible until a customer and a free time are chosen, and says which is missing", async () => {
    await show();
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled();
    expect(screen.getByText("Choose the customer first.")).toBeInTheDocument();
    await search("Sri");
    await click(/Sri Lakshmi Silks/);
    expect(screen.getByText("Choose a free time.")).toBeInTheDocument();
    await click(/^11:00/);
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeEnabled();
  });
  it("books with the page's id, the day, the time, the people, the purpose and the note; no advance unless asked", async () => {
    const actions = await show();
    await fill();
    type("How many people", "3");
    type("What for", " Bridal sarees ");
    type("Note (optional)", "Coming with her mother");
    await click("Book the visit");
    expect(actions.book).toHaveBeenCalledTimes(1);
    expect(actions.book).toHaveBeenCalledWith({ visitId: expect.stringMatching(/^[0-9a-f-]{36}$/), leadId: "c5c78ed6-e536-46af-a5c3-872bb2d844a2", date: TODAY, slot: "11:00", partySize: 3, purpose: "Bridal sarees", note: "Coming with her mother", advanceRupees: null });
    expect(screen.getByRole("status")).toHaveTextContent("Booked: Priya S.");
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent to the customer");
  });
  it("after a booking the form is empty again with a NEW id, but the day stays", async () => {
    const actions = await show();
    await fill();
    await click("Book the visit");
    await fill();
    await click("Book the visit");
    const [a, b] = actions.book.mock.calls.map((c) => c[0].visitId);
    expect(a).not.toBe(b);
    expect(actions.book.mock.calls[1][0].date).toBe(TODAY);
    expect(actions.book.mock.calls[1][0].partySize).toBe(1);
  });
  it("a refusal shows our sentence, keeps everything typed, and a retry uses the same id", async () => {
    const book = vi.fn().mockResolvedValueOnce({ ok: false, error: "Every place at that time is taken. Choose another time.", stale: true }).mockResolvedValueOnce({ ok: true, message: "Booked: Priya S." });
    const actions = await show({}, fakeVisitsActions({ book }));
    await fill();
    type("What for", "Bridal sarees");
    await click("Book the visit");
    expect(screen.getByRole("alert")).toHaveTextContent("Every place at that time is taken. Choose another time.");
    expect(screen.getByLabelText("What for")).toHaveValue("Bridal sarees");
    expect(screen.getByRole("button", { name: /^11:00/ })).toHaveAttribute("aria-pressed", "true");
    await click("Book the visit");
    expect(actions.book.mock.calls[0][0].visitId).toBe(actions.book.mock.calls[1][0].visitId);
  });
  it("an advance is off by default, never required, and when asked for is sent in rupees", async () => {
    const actions = await show();
    expect(screen.getByLabelText("Ask for an advance")).not.toBeChecked();
    expect(screen.queryByLabelText("Advance (₹)")).toBeNull();
    await fill();
    await click("Book the visit");
    expect(actions.book.mock.calls[0][0].advanceRupees).toBeNull();
    await fill();
    fireEvent.click(screen.getByLabelText("Ask for an advance"));
    type("Advance (₹)", "500");
    expect(screen.getByText(/Asking for an advance does not stop the visit/)).toBeInTheDocument();
    await click("Book the visit");
    expect(actions.book.mock.calls[1][0].advanceRupees).toBe(500);
  });
  it("an advance that is not a sensible amount, or a party of nobody, blocks the button", async () => {
    await show();
    await fill();
    fireEvent.click(screen.getByLabelText("Ask for an advance"));
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled(); // asked for but empty
    type("Advance (₹)", "0");
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled();
    type("Advance (₹)", "250");
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeEnabled();
    type("How many people", "0");
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled();
    type("How many people", "51");
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled();
  });
  it("starts on the chosen day and time when it comes from a free time", async () => {
    const actions = await show({ start: { date: TODAY, slot: "10:30" }, lead: { leadId: LEAD_A, label: "Priya S." } });
    await click("Book the visit");
    expect(actions.book.mock.calls[0][0]).toMatchObject({ date: TODAY, slot: "10:30", leadId: LEAD_A });
  });
  it("says it does not message the customer", async () => {
    await show();
    expect(screen.getByText("Booking does not message the customer. The visit waits until you confirm it with them.")).toBeInTheDocument();
  });
  it("the fields are at least 44 px high and the page shows no number", async () => {
    await show();
    for (const el of [screen.getByLabelText("How many people"), screen.getByLabelText("What for")]) expect(el.className).toContain("min-h-12");
    expect(document.body.textContent).not.toMatch(/\+?\d[\d ]{9,}/);
  });
});
