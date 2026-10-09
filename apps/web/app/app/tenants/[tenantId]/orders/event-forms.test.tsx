import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { btnMain, btnQuiet } from "@/components/v2/app/ui";
import { EVENT_TYPES, LOST_REASONS, type EventType } from "@/lib/api/orders";

import { EventForm, type EventFormIds } from "./event-form";
import { StartOrderForm } from "./start-order-form";

const ids: EventFormIds = {
  eventId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  ledgerId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  renderedAt: "2026-10-06T08:30:00.000Z",
  today: "2026-10-06",
};
const ok = () => vi.fn(async () => ({ ok: true as const, message: "Recorded." }));
const hidden = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;

describe("EventForm", () => {
  it.each(EVENT_TYPES.filter((t) => !["record_payment", "record_refund", "customer_decline"].includes(t)))("%s is one button and the page's ids; nothing else to fill in", (type) => {
    render(<EventForm type={type} action={ok()} ids={ids} secondFactorMissing={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(hidden("event_id")).toBe(ids.eventId);
    expect(hidden("rendered_at")).toBe(ids.renderedAt);
    expect(hidden("ledger_id")).toBeUndefined(); // only a money event has a ledger id
    expect(screen.queryByLabelText("Amount in rupees")).toBeNull();
    expect(screen.queryByLabelText("Why")).toBeNull();
  });

  it.each(["record_payment", "record_refund"] as EventType[])("%s asks for the amount in rupees and the day, defaults to today, and carries a ledger id", (type) => {
    render(<EventForm type={type} action={ok()} ids={ids} secondFactorMissing={false} />);
    expect(screen.getByLabelText("Amount in rupees")).toBeRequired();
    const day = screen.getByLabelText("The day it happened") as HTMLInputElement;
    expect(day.value).toBe("2026-10-06");
    expect(day.max).toBe("2026-10-06"); // never a future day
    expect(hidden("ledger_id")).toBe(ids.ledgerId);
    expect(screen.getByText(/Nothing is collected or paid from here/)).toBeInTheDocument();
  });

  it("a decline asks for one reason from the closed list and chooses none for the person", () => {
    render(<EventForm type="customer_decline" action={ok()} ids={ids} secondFactorMissing={false} />);
    const select = screen.getByLabelText("Why") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", ...LOST_REASONS]);
  });

  it("a cancellation and a refund are the quiet buttons; the others are the main one", () => {
    for (const type of ["cancel", "record_refund"] as EventType[]) {
      const { unmount } = render(<EventForm type={type} action={ok()} ids={ids} secondFactorMissing={false} />);
      expect(screen.getByRole("button").className).toBe(btnQuiet);
      unmount();
    }
    for (const type of ["send_quote", "record_payment", "customer_decline", "dispatch"] as EventType[]) {
      const { unmount } = render(<EventForm type={type} action={ok()} ids={ids} secondFactorMissing={false} />);
      expect(screen.getByRole("button").className).toBe(btnMain);
      unmount();
    }
  });

  it("a dispatch says only the owner can go without the advance", () => {
    render(<EventForm type="dispatch" action={ok()} ids={ids} secondFactorMissing={false} />);
    expect(screen.getByText(/only the owner can dispatch/)).toBeInTheDocument();
  });

  it.each(["record_payment", "cancel", "record_refund"] as EventType[])("%s without the second factor shows the notice and no way to submit", (type) => {
    render(<EventForm type={type} action={ok()} ids={ids} secondFactorMissing />);
    expect(screen.getByRole("note")).toHaveTextContent("This needs your authenticator app.");
    expect(screen.getByRole("link", { name: "Set it up on the Security page" })).toHaveAttribute("href", "/app/security");
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("input[name=event_id]")).toBeNull();
  });

  it("sends the person's input to the action and shows its outcome", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "The advance has not been paid." }));
    render(<EventForm type="record_payment" action={action} ids={ids} secondFactorMissing={false} />);
    fireEvent.change(screen.getByLabelText("Amount in rupees"), { target: { value: "25,000" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record this payment" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The advance has not been paid."));
    const sent = (action.mock.calls as unknown as [unknown, FormData][])[0][1];
    expect(sent.get("amount")).toBe("25,000");
    expect(sent.get("event_id")).toBe(ids.eventId);
    expect(sent.get("ledger_id")).toBe(ids.ledgerId);
    expect(sent.get("happened_on")).toBe("2026-10-06");
  });

  it("shows a success as a status, and says nothing was sent", async () => {
    render(<EventForm type="send_quote" action={vi.fn(async () => ({ ok: true as const, message: "Recorded: I sent the quote. Nothing was sent to anyone." }))} ids={ids} secondFactorMissing={false} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record: quote sent" })));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent to anyone."));
  });
});

describe("StartOrderForm", () => {
  const props = { start: vi.fn(async () => undefined), orderId: ids.eventId };

  it.each(["sales", "viewer"])("%s is told who starts an order and is shown no button", (role) => {
    render(<StartOrderForm {...props} role={role} secondFactorMissing={false} />);
    expect(screen.getByText("An owner or admin starts an order from an approved quote.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["owner", "admin"])("%s without the second factor gets the notice, not a raw error", (role) => {
    render(<StartOrderForm {...props} role={role} secondFactorMissing />);
    expect(screen.getByRole("note")).toHaveTextContent("Starting an order needs your authenticator app.");
    expect(screen.getByRole("link", { name: "Set it up on the Security page" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["owner", "admin"])("%s with it gets the button, the page's order id and the promise that nothing is sent", async (role) => {
    const start = vi.fn(async () => ({ ok: false as const, error: "This quote already has an order." }));
    render(<StartOrderForm start={start} orderId={ids.eventId} role={role} secondFactorMissing={false} />);
    expect(hidden("order_id")).toBe(ids.eventId);
    expect(screen.getByText(/nothing is sent to anyone/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start order" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This quote already has an order."));
  });
});
