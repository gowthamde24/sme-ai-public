import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { visit } from "@/lib/api/visits-fixtures";
import type { Visit } from "@/lib/api/visits";

import type { Role } from "../today/types";
import { VisitCard } from "./VisitCard";
import { BASE, NOW, TODAY, WORDS, fakeVisitsActions } from "./visits-test-kit";

const ORDER = "c9dcf181-dc56-4bee-acf1-3845a5eebede";
const show = (v: Visit, { role = "owner" as Role, actions = fakeVisitsActions(), now = NOW } = {}) => {
  render(<VisitCard visit={v} role={role} actions={actions} words={WORDS} lang="en" now={now} today={TODAY} base={BASE} slotsMin={TODAY} />);
  return actions;
};
const names = () => screen.queryAllByRole("button").map((b) => b.textContent);
const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
/** 12:00 India on the 14th: the visit's time (10:30) is behind us. */
const LATER = Date.parse("2026-10-14T06:30:00Z");

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("a visit: what it shows", () => {
  it("who, how many, when (Indian clock), what for, the note, and where it stands", () => {
    show(visit({ note: "Coming with her mother", city: "Hyderabad", customer: "Sri Lakshmi Silks" }));
    const a = screen.getByRole("article");
    expect(within(a).getByRole("heading")).toHaveTextContent("Priya S. + 2 · Hyderabad");
    expect(within(a).getByText("3 people")).toBeInTheDocument();
    expect(within(a).getByText("10:30")).toBeInTheDocument();
    expect(within(a).getByText("Sri Lakshmi Silks")).toBeInTheDocument();
    expect(within(a).getByText("Bridal sarees")).toBeInTheDocument();
    expect(within(a).getByText("Coming with her mother")).toBeInTheDocument();
    expect(within(a).getByText("Waiting for the customer")).toBeInTheDocument();
  });
  it("a visit your assistant proposed says so and waits for a person", () => {
    show(visit({ source: "assistant" }));
    expect(screen.getByText("Proposed by your assistant · waiting for you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });
  it("shows the advance in rupees only when it was asked for", () => {
    show(visit({ advance_requested: true, advance_paise: 50000 }));
    expect(screen.getByText("Advance asked: ₹500.00")).toBeInTheDocument();
    cleanup();
    show(visit());
    expect(screen.queryByText(/Advance/)).toBeNull();
  });
  it("a confirmed visit whose reminder went out says so; the outcome, the reason and the order show on a finished one", () => {
    show(visit({ status: "confirmed", reminder_sent: true }));
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Reminder sent")).toBeInTheDocument();
    cleanup();
    show(visit({ status: "completed", outcome: "bought", order_id: ORDER }));
    expect(screen.getByText("Bought")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the order" })).toHaveAttribute("href", `${BASE}/orders/${ORDER}`);
    cleanup();
    show(visit({ status: "cancelled", cancel_reason: "The customer called" }));
    expect(screen.getByText("Reason: The customer called")).toBeInTheDocument();
  });
  it("long names and notes wrap instead of widening the card", () => {
    show(visit({ who: "A".repeat(80), note: "n".repeat(300) }));
    expect(screen.getByRole("heading").className).toContain("[overflow-wrap:anywhere]");
  });
});

describe("a visit: the buttons that fit where it stands", () => {
  it("booked, today, before its time: Confirm, They are here, Change time, Cancel", () => {
    show(visit({ status: "booked" }));
    expect(names()).toEqual(["Confirm", "They are here", "Change time", "Cancel"]);
  });
  it("booked, after its time: also Did not come", () => {
    show(visit({ status: "booked" }), { now: LATER });
    expect(names()).toEqual(["Confirm", "They are here", "Change time", "Did not come", "Cancel"]);
  });
  it("confirmed: They are here, Change time, Cancel (no Confirm again)", () => {
    show(visit({ status: "confirmed" }));
    expect(names()).toEqual(["They are here", "Change time", "Cancel"]);
  });
  it("arrived: only Complete", () => {
    show(visit({ status: "arrived" }));
    expect(names()).toEqual(["Complete"]);
  });
  it.each(["completed", "no_show", "cancelled"] as const)("%s: no buttons", (status) => {
    show(visit({ status }));
    expect(names()).toEqual([]);
  });
  it("'They are here' is only for the day itself", () => {
    show(visit({ status: "confirmed", date: "2026-10-15" }));
    expect(names()).toEqual(["Change time", "Cancel"]);
  });
  it("a Viewer sees the visit and no buttons; Sales and Admin have them", () => {
    show(visit(), { role: "viewer" });
    expect(names()).toEqual([]);
    for (const role of ["sales", "admin", "owner"] as const) {
      cleanup();
      show(visit(), { role });
      expect(names()).toContain("Confirm");
    }
  });
  it("every button is at least 44 px high", () => {
    show(visit({ status: "booked" }), { now: LATER });
    for (const b of screen.getAllByRole("button")) expect(b.className, b.textContent ?? "").toMatch(/min-h-1[12]/);
  });
});

describe("a visit: the steps", () => {
  it("Confirm, They are here and Did not come each call their own step with the visit's id, and say what happened", async () => {
    const actions = show(visit({ status: "booked" }), { now: LATER });
    await click("Confirm");
    expect(actions.confirm).toHaveBeenCalledWith(visit().id);
    expect(screen.getByRole("status")).toHaveTextContent("Confirmed for Priya S., and nothing was sent to the customer.");
    await click("They are here");
    expect(actions.arrive).toHaveBeenCalledWith(visit().id);
    await click("Did not come");
    expect(actions.noShow).toHaveBeenCalledWith(visit().id);
  });
  it("Cancel asks for an optional reason, and the visit is cancelled only on the second press", async () => {
    const actions = show(visit({ status: "confirmed" }));
    await click("Cancel");
    expect(actions.cancel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: " The customer called " } });
    expect(screen.getByText(/Nothing is sent to the customer; tell them yourself\./)).toBeInTheDocument();
    await click("Cancel this visit");
    expect(actions.cancel).toHaveBeenCalledWith(visit().id, "The customer called");
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled for Priya S.");
  });
  it("'Keep it' closes the cancel box without cancelling", async () => {
    const actions = show(visit());
    await click("Cancel");
    await click("Keep it");
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull();
  });
  it("Change time shows the free times of the visit's day; choosing one moves the visit", async () => {
    const actions = show(visit({ status: "confirmed" }));
    await click("Change time");
    expect(actions.slots).toHaveBeenCalledWith("2026-10-14");
    expect(screen.getByText(/waits for the customer to confirm again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move the visit" })).toBeDisabled();
    await act(async () => fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-15" } }));
    await click(/^12:00/);
    await click("Move the visit");
    expect(actions.move).toHaveBeenCalledWith(visit().id, "2026-10-15", "12:00");
    expect(screen.getByRole("status")).toHaveTextContent(/^Moved to /);
  });
  it("a double press does not start a second step while one is running", async () => {
    let finish!: (v: { ok: true; message: string }) => void;
    const confirm = vi.fn(() => new Promise<{ ok: true; message: string }>((r) => (finish = r)));
    show(visit(), { actions: fakeVisitsActions({ confirm }) });
    await click("Confirm");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await act(async () => finish({ ok: true, message: "Confirmed for Priya S." }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("a visit: completing it", () => {
  const arrived = () => visit({ status: "arrived" });
  it("asks how it ended; 'Will come back' and 'Not interested' complete it with that outcome and no order", async () => {
    const actions = show(arrived());
    await click("Complete");
    expect(screen.getByText("How did the visit end?")).toBeInTheDocument();
    await click("Will come back");
    expect(actions.complete).toHaveBeenCalledWith(visit().id, "will_return", null);
  });
  it("'Not interested' completes it with that outcome", async () => {
    const actions = show(arrived());
    await click("Complete");
    await click("Not interested");
    expect(actions.complete).toHaveBeenCalledWith(visit().id, "not_interested", null);
  });
  it("'Bought: I will make the order later' completes it as bought without an order", async () => {
    const actions = show(arrived());
    await click("Complete");
    await click("Bought: I will make the order later");
    expect(actions.complete).toHaveBeenCalledWith(visit().id, "bought", null);
  });
  it("'Bought: start the order' sends the id of the order the page made, the same id on a retry", async () => {
    const complete = vi.fn().mockResolvedValueOnce({ ok: false, error: "x", quotes: true }).mockResolvedValueOnce({ ok: true, message: "Done. The order was started from the approved quote.", orderId: ORDER });
    show(arrived(), { actions: fakeVisitsActions({ complete }) });
    await click("Complete");
    await click("Bought: start the order");
    const first = complete.mock.calls[0][2];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await click("Bought: start the order"); // the panel stays open after a refusal
    expect(complete.mock.calls[1][2]).toBe(first);
    expect(screen.getByRole("status")).toHaveTextContent("Done. The order was started from the approved quote.");
    expect(screen.getByRole("link", { name: "Open the order" })).toHaveAttribute("href", `${BASE}/orders/${ORDER}`);
  });
  it("with no approved quote it says so in words and points at the quotes; the visit stays here", async () => {
    const complete = vi.fn(async () => ({ ok: false as const, error: "This customer has no approved quote without an order yet, so no order can be made.", quotes: true }));
    show(arrived(), { actions: fakeVisitsActions({ complete }) });
    await click("Complete");
    await click("Bought: start the order");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("no approved quote");
    expect(within(alert).getByRole("link", { name: "Open the quotes" })).toHaveAttribute("href", `${BASE}/quotes`);
    expect(screen.getByText("How did the visit end?")).toBeInTheDocument(); // not completed: the choices are still there
  });
  it("without the second factor it shows the way to Security", async () => {
    const complete = vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true }));
    show(arrived(), { actions: fakeVisitsActions({ complete }) });
    await click("Complete");
    await click("Bought: start the order");
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
  });
  it("Sales is not offered to start the order, and is told who can", async () => {
    show(arrived(), { role: "sales" });
    await click("Complete");
    expect(screen.queryByRole("button", { name: "Bought: start the order" })).toBeNull();
    expect(screen.getByText(/Only the owner or an admin can start the order from a visit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bought: I will make the order later" })).toBeInTheDocument();
  });
  it("an Admin is offered to start the order", async () => {
    show(arrived(), { role: "admin" });
    await click("Complete");
    expect(screen.getByRole("button", { name: "Bought: start the order" })).toBeInTheDocument();
  });
});
