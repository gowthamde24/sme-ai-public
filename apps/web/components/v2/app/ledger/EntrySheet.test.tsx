import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { WORDS } from "../materials/mat-test-kit";
import { EntrySheet, type EntryKind, type RecordAction } from "./EntrySheet";

const RECEIPTS = "/app/tenants/t/dues/receipt";
function show(over: Partial<React.ComponentProps<typeof EntrySheet>> = {}, record: RecordAction = vi.fn(async (i) => ({ ok: true as const, receiptNo: i.kind === "payment" ? "R/2026-27/000012" : null, entryId: i.entryId, replayed: false }))) {
  render(<EntrySheet kinds={["payment", "charge", "adjustment"] as readonly EntryKind[]} prefix="due" words={WORDS} record={record} today="2026-10-14" receiptBase={RECEIPTS} secondFactorMissing={false} role="owner" {...over} />);
  return record as ReturnType<typeof vi.fn>;
}
const click = (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => refresh.mockClear());

describe("writing down a payment", () => {
  it("shows the amount in words as it is typed", async () => {
    show();
    await click("Write down a payment");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1,25,000.50" } });
    expect(screen.getByText(/Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only \(₹1,25,000.50\)/)).toBeInTheDocument();
  });
  it("refuses an amount that is not an amount, before asking the server", async () => {
    const record = show();
    await click("Write down a payment");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "abc" } });
    await click("Write down the payment");
    expect(screen.getByRole("alert")).toHaveTextContent("Write the amount in rupees");
    expect(record).not.toHaveBeenCalled();
  });
  it("records it once with a new id, then links the receipt", async () => {
    const record = show();
    await click("Write down a payment");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "70000" } });
    fireEvent.change(screen.getByLabelText("How it was paid"), { target: { value: "upi" } });
    await click("Write down the payment");
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ kind: "payment", amount: "70000", method: "upi", entryDate: "2026-10-14" });
    expect(record.mock.calls[0][0].entryId).toMatch(/^[0-9a-f-]{36}$/);
    const done = screen.getByRole("status");
    expect(done).toHaveTextContent("The payment is written down.");
    expect(within(done).getByRole("link", { name: "Receipt R/2026-27/000012" })).toHaveAttribute("href", `${RECEIPTS}/${record.mock.calls[0][0].entryId}`);
    expect(refresh).toHaveBeenCalled();
  });
  it("says why a refusal happened and offers the Security page for the second factor", async () => {
    show({}, vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app.", mfa: true })) as never);
    await click("Adjust the account");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "500" } });
    await click("Write down the adjustment");
    expect(screen.getByRole("alert")).toHaveTextContent("authenticator");
    expect(screen.getByRole("link", { name: /Security/ })).toBeInTheDocument();
  });
});

describe("who may write what", () => {
  it("Sales can write payments and invoices but not adjustments or concessions", () => {
    show({ role: "sales", kinds: ["payment", "charge", "adjustment", "concession"] });
    expect(screen.getByRole("button", { name: "Write down a payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add an invoice" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust the account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Give a concession" })).toBeNull();
  });
  it("a Viewer sees no button", () => {
    show({ role: "viewer" });
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("an Admin is told in advance that adjustments need the authenticator code", () => {
    show({ role: "admin", secondFactorMissing: true });
    expect(screen.getByText(/Adjustments and concessions need your authenticator code/)).toBeInTheDocument();
  });
  it("an invoice's due date cannot be before its date", async () => {
    const record = show();
    await click("Add an invoice");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Due on"), { target: { value: "2026-10-01" } });
    await click("Add the invoice");
    expect(screen.getByRole("alert")).toHaveTextContent("due date cannot be before");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("a school's account (fee words)", () => {
  const feeKinds = ["payment", "concession", "adjustment"] as readonly EntryKind[];
  it("a concession by percent takes a whole number 1 to 100 and sends the mode", async () => {
    const record = show({ kinds: feeKinds, prefix: "fee" });
    await click("Give a concession");
    fireEvent.click(screen.getByRole("radio", { name: /A percentage of what was charged/ }));
    fireEvent.change(screen.getByLabelText("Percentage (1 to 100)"), { target: { value: "101" } });
    await click(/Give the concession|Write down the concession/);
    expect(screen.getByRole("alert")).toHaveTextContent("whole number from 1 to 100");
    expect(record).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Percentage (1 to 100)"), { target: { value: "10" } });
    await click(/Give the concession|Write down the concession/);
    expect(record.mock.calls[0][0]).toMatchObject({ kind: "concession", amount: "10", mode: "percent", reasonCode: "scholarship" });
  });
  it("a concession by amount still shows the amount in words", async () => {
    show({ kinds: feeKinds, prefix: "fee" });
    await click("Give a concession");
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2000" } });
    expect(screen.getByText(/Two Thousand/i)).toBeInTheDocument();
  });
  it("an adjustment starts as a correction and a late fee is not on the list a person may choose", async () => {
    show({ kinds: feeKinds, prefix: "fee" });
    await click("Adjust the account");
    const select = screen.getByLabelText("Reason") as HTMLSelectElement;
    expect(select.value).toBe("correction");
    expect(within(select).queryByRole("option", { name: /late fee/i })).toBeNull();
  });
});
