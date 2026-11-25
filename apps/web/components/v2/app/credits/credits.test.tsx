import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { Order, Statement as StatementData, TopupOptions } from "@/lib/api/credits";

import { AddCredits } from "./AddCredits";
import { LowBalance } from "./LowBalance";
import { Statement } from "./Statement";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("cr.")));
const OPTIONS: TopupOptions = { gstPercent: 18, customMin: 100, customMax: 100000, mode: "fake", checkoutReady: true, presets: [500, 1000, 2000, 5000].map((r) => ({ addedPaise: r * 100, gstPaise: r * 18, totalPaise: r * 118, addedText: `₹${r.toLocaleString("en-IN")}`, gstText: "", totalText: "" })) };
const ORDER: Order = { mode: "fake", orderId: "order_1", keyId: null, amountPaise: 118000, addedText: "₹1,000", gstText: "₹180", totalText: "₹1,180", name: "Shop", description: "Credits" };

describe("Add credits", () => {
  it("shows credits, GST and the total as three lines for the chosen amount, and says it is a test", () => {
    render(<AddCredits options={OPTIONS} words={words} actions={{ create: vi.fn(), confirm: vi.fn(), fail: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    const sum = document.querySelector('[data-part="topup-sum"]') as HTMLElement;
    expect(within(sum).getByText("₹1,000")).toBeInTheDocument(); // the second preset is the default
    expect(within(sum).getByText("₹180")).toBeInTheDocument();
    expect(within(sum).getByText("₹1,180")).toBeInTheDocument();
    expect(screen.getByText("This is a test: no money moves.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Another amount/), { target: { value: "333" } });
    expect(within(sum).getByText("₹59.94")).toBeInTheDocument(); // 18% rounded half up to the paisa
    expect(within(sum).getByText("₹392.94")).toBeInTheDocument();
  });
  it("pays: makes the order, the fake payment, confirms it once, says what was added and reads the page again", async () => {
    const create = vi.fn(async () => ({ ok: true as const, order: ORDER }));
    const confirm = vi.fn(async () => ({ ok: true as const, addedText: "₹1,000" }));
    render(<AddCredits options={OPTIONS} words={words} actions={{ create, confirm, fail: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹1,180" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(1000));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const [order, pay, sig] = confirm.mock.calls[0] as unknown as [string, string, string];
    expect(order).toBe("order_1");
    expect(pay).toMatch(/^pay_fake_/);
    expect(sig).toBe("sig_fake_ok");
    expect(await screen.findByText("Done. ₹1,000 added to your balance.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
  it("an amount the server refuses is one plain sentence and nothing is paid", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "forbidden" as const }));
    const confirm = vi.fn();
    render(<AddCredits options={OPTIONS} words={words} actions={{ create, confirm, fail: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹1,180" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Owner can add credits.");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("an amount outside the range keeps Pay off", () => {
    render(<AddCredits options={OPTIONS} words={words} actions={{ create: vi.fn(), confirm: vi.fn(), fail: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    fireEvent.change(screen.getByLabelText(/Another amount/), { target: { value: "50" } });
    expect(screen.getByRole("button", { name: /^Pay/ })).toBeDisabled();
  });
});

describe("low balance and statement", () => {
  it("the low-balance line is the neutral notice with the button beside it", () => {
    render(<LowBalance minutes={4} words={words} add={<button type="button">Add credits</button>} />);
    expect(screen.getByRole("status")).toHaveTextContent("Your balance is low: about 4 minutes of calls left.");
    expect(screen.getByRole("button", { name: "Add credits" })).toBeInTheDocument();
  });
  const FIRST: StatementData = { items: [{ at: "2026-11-24T10:00:00Z", kind: "credit", label: "Top-up", amountPaise: 100000, amountText: "₹1,000", balanceAfterText: "₹1,100", invoiceNumber: "S19-2627-000001" }, { at: "2026-11-24T11:00:00Z", kind: "usage", label: "Calls", amountPaise: -500, amountText: "-₹5", balanceAfterText: "₹1,095", invoiceNumber: null }], hasMore: true, nextBefore: "b1", balanceText: "₹1,095" };
  it("lists what was added and taken, links a top-up to its invoice and reads earlier lines on request", async () => {
    const load = vi.fn(async () => ({ ok: true as const, statement: { ...FIRST, items: [{ ...FIRST.items[1], label: "Earlier" }], hasMore: false, nextBefore: null } }));
    render(<Statement first={FIRST} words={words} base="/b" load={load} />);
    expect(screen.getByRole("link", { name: "Invoice S19-2627-000001" })).toHaveAttribute("href", "/b/billing/invoices/S19-2627-000001");
    expect(screen.getByText("+ ₹1,000")).toBeInTheDocument();
    expect(screen.getByText("− ₹5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show earlier" }));
    expect(await screen.findByText("Earlier")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("b1");
    expect(screen.queryByRole("button", { name: "Show earlier" })).toBeNull();
  });
});
