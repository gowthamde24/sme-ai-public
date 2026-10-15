import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseCallList } from "@/lib/api/campaigns";
import { CALL_LIST_JSON, CALL_REQUEST } from "@/lib/api/campaigns-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { CallList, type CallListActions } from "./CallList";

const items = parseCallList(CALL_LIST_JSON).items;
function show(over: Partial<React.ComponentProps<typeof CallList>> = {}, a: Partial<CallListActions> = {}) {
  const actions = { connect: vi.fn(async () => ({ ok: true as const, replayed: false })), outcome: vi.fn(async () => ({ ok: true as const })), ...a } as CallListActions & { connect: ReturnType<typeof vi.fn>; outcome: ReturnType<typeof vi.fn> };
  render(<CallList items={items} words={WORDS} canCall today="2026-10-21" actions={actions} tab="open" base={BASE} more={null} {...over} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("the call list", () => {
  it("never shows a phone number and says what is overdue", () => {
    show();
    expect(document.body.textContent).not.toMatch(/\d{10}/);
    expect(screen.getAllByText(/Was due 2026-10-20/).length).toBeGreaterThan(0);
  });
  it("rings through the bridge for the first row and says whose phone rings first", async () => {
    const a = show();
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Call" })[0]));
    expect(a.connect).toHaveBeenCalledWith(CALL_REQUEST);
    expect(screen.getByRole("status")).toHaveTextContent("Your phone will ring first");
  });
  it("a refusal shows OUR sentence on that row", async () => {
    show({}, { connect: vi.fn(async () => ({ ok: false as const, error: "Calls can only be made from 9 am to 9 pm India time." })) });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Call" })[0]));
    expect(screen.getByRole("alert")).toHaveTextContent("9 am to 9 pm");
  });
  it("a Sales member can write the outcome but has no call button", () => {
    show({ canCall: false });
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Paid" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Only the Owner and Admins can ring/)).toBeInTheDocument();
  });
  it.each([["Paid", { outcome: "paid" }], ["Wrong number", { outcome: "wrong_number" }], ["Stop contacting", { outcome: "stop" }]])("one tap on %s writes it down", async (name, body) => {
    const a = show();
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name })[0]));
    expect(a.outcome).toHaveBeenCalledWith(items[0].id, body);
    expect(refresh).toHaveBeenCalled();
  });
  it("a promise asks for the date first and will not take one in the past", async () => {
    const a = show();
    fireEvent.click(screen.getAllByRole("button", { name: "Promised a date" })[0]);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The date they promised to pay"), { target: { value: "2026-10-20" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The date they promised to pay"), { target: { value: "2026-10-25" } });
    await act(async () => void fireEvent.click(save));
    expect(a.outcome).toHaveBeenCalledWith(items[0].id, { outcome: "promised", promisedOn: "2026-10-25" });
  });
  it("call later sends a time of day in India", async () => {
    const a = show();
    fireEvent.click(screen.getAllByRole("button", { name: "Call later" })[0]);
    fireEvent.change(screen.getByLabelText("Call again on"), { target: { value: "2026-10-23" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(a.outcome).toHaveBeenCalledWith(items[0].id, { outcome: "call_later", callAfter: "2026-10-23T10:00:00+05:30" });
  });
  it("the done tab shows the outcome and no buttons", () => {
    const done = items.map((i) => ({ ...i, status: "done" as const, outcome: "promised" as const, promised_on: "2026-10-25" }));
    show({ items: done, tab: "done" });
    expect(screen.queryByRole("button", { name: "Paid" })).toBeNull();
    expect(screen.getAllByText("Promised a date").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Promised on 2026-10-25/).length).toBeGreaterThan(0);
  });
  it("an empty list says so", () => {
    show({ items: [] });
    expect(screen.getByText("Nobody to call right now.")).toBeInTheDocument();
  });
});
