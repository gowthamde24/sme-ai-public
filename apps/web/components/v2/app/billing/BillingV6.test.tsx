import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseBillingBalance } from "@/lib/billing-v6/balance";
import { mockInvoices } from "@/lib/billing-v6/invoices";
import { TOPUP_CHOICES } from "@/lib/billing-v6/mock-state";
import { MOCK_PRICING } from "@/lib/billing-v6/pricing";
import { formatRupeesShort } from "@/lib/money";

import { BillingV6, type BillingV6Props } from "./BillingV6";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const WIRE = { balance_paise: 155_000, minutes_estimate: 310, plan_id: "sales_assistant", plan_name: "Sales assistant", low: false, topup_available: true, free_start_granted: false, free_start_left_paise: 0, included_minutes: 500, included_minutes_left: 342, subscription: { interval: "monthly", status: "active", period_end: "2026-12-13T05:00:00Z", cancel_at_period_end: false } };
const props = (over: Partial<BillingV6Props> = {}): BillingV6Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  help: <button type="button">?</button>,
  balance: parseBillingBalance(WIRE),
  pricing: MOCK_PRICING,
  invoices: { items: mockInvoices({ freeStart: false, topups: [] }), test: true },
  owner: true,
  topupAmounts: TOPUP_CHOICES.map((paise) => ({ paise, text: formatRupeesShort(paise) })),
  actions: { freeStart: async () => ({ ok: true }), topup: async () => ({ ok: true }) },
  mock: true,
  ...over,
});

describe("Billing (design system v6)", () => {
  it("shows the plan with its price from the catalogue, the minutes left and when it renews, with Change plan", () => {
    render(<BillingV6 {...props()} />);
    const plan = screen.getByRole("region", { name: "Your plan" });
    expect(plan).toHaveTextContent("Sales assistant");
    expect(plan).toHaveTextContent("₹1,999 a month");
    expect(plan).toHaveTextContent("342 of 500 minutes left this month");
    expect(plan).toHaveTextContent("Renews on December 13, 2026");
    expect(within(plan).getByRole("progressbar")).toHaveAttribute("value", "158");
    expect(within(plan).getByRole("link", { name: "Change plan" })).toHaveAttribute("href", "/app/tenants/t1/plans");
  });
  it("shows the balance in rupees and call minutes, never the word credits", () => {
    render(<BillingV6 {...props()} />);
    const bal = screen.getByRole("region", { name: "Your balance" });
    expect(bal).toHaveTextContent("₹1,550");
    expect(bal).toHaveTextContent("About 310 call minutes");
    expect(document.body.textContent).not.toMatch(/credit/i);
  });
  it("lists the three plans, marks the current one, and points the others to the picker", () => {
    render(<BillingV6 {...props()} />);
    const plans = within(screen.getByRole("region", { name: "Plans" }));
    expect(plans.getAllByRole("listitem").filter((li) => li.hasAttribute("data-plan")).map((li) => li.getAttribute("data-plan"))).toEqual(["payg", "sales_assistant", "sales_lead_finder"]);
    expect(document.querySelector('[data-plan="sales_assistant"]')).toHaveAttribute("data-current", "true");
    expect(document.querySelector('[data-plan="payg"]')).toHaveTextContent("Choose this plan");
    expect(document.querySelector('[data-plan="sales_lead_finder"]')).toHaveTextContent("Includes Lead Finder");
    expect(document.body).toHaveTextContent("+18% GST on invoices");
  });
  it("a low balance says so; the free start is claimed once by the owner only", async () => {
    const freeStart = vi.fn(async () => ({ ok: true as const }));
    const { rerender } = render(<BillingV6 {...props({ mock: false, balance: parseBillingBalance({ ...WIRE, low: true }), actions: { freeStart, topup: async () => ({ ok: true }) } })} />);
    expect(screen.getByRole("note")).toHaveTextContent("balance is low");
    fireEvent.click(screen.getByRole("button", { name: "Claim your free start" }));
    await waitFor(() => expect(freeStart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(<BillingV6 {...props({ owner: false })} />);
    expect(screen.queryByRole("button", { name: "Claim your free start" })).toBeNull();
    rerender(<BillingV6 {...props({ balance: parseBillingBalance({ ...WIRE, free_start_granted: true, free_start_left_paise: 4000 }) })} />);
    expect(screen.queryByRole("button", { name: "Claim your free start" })).toBeNull();
    expect(screen.getByText("Free start left: ₹40")).toBeInTheDocument();
  });
  it("Change plan and Choose are the owner's only", () => {
    render(<BillingV6 {...props({ owner: false })} />);
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull();
    expect(screen.queryByText("Choose this plan")).toBeNull();
  });
  it("lists the invoices with the GST inside, every one marked as a test", () => {
    render(<BillingV6 {...props()} />);
    const inv = screen.getByRole("region", { name: "Invoices" });
    expect(inv).toHaveTextContent("These invoices are made up");
    const rows = inv.querySelectorAll("[data-invoice]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Plan");
    expect(rows[0]).toHaveTextContent("₹2,358.82");
    expect(rows[0]).toHaveTextContent("₹359 GST included".replace("₹359", formatRupeesShort(35982)));
    expect(rows[0]).toHaveTextContent("Test");
  });
  it("says when there are no invoices yet", () => {
    render(<BillingV6 {...props({ invoices: { items: [], test: false } })} />);
    expect(screen.getByText("Invoices will show here after your first payment.")).toBeInTheDocument();
  });
  it("says when billing cannot be read, and still leads to the plans", () => {
    render(<BillingV6 {...props({ balance: null })} />);
    expect(screen.getByText(/Billing is not available right now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change plan" })).toHaveAttribute("href", "/app/tenants/t1/plans");
  });
  it("marks test data and has the page header with the '?'", () => {
    render(<BillingV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("no real money moves");
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
  });
});

describe("Add money", () => {
  it("opens a sheet marked TEST with four amounts, pays the chosen one and reads the page again", async () => {
    const topup = vi.fn(async () => ({ ok: true as const }));
    render(<BillingV6 {...props({ actions: { freeStart: async () => ({ ok: true }), topup } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    const sheet = screen.getByRole("dialog", { name: "Add money" });
    expect(within(sheet).getByText(/TEST: no real money moves/)).toBeInTheDocument();
    const radios = within(sheet).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["₹500", "₹1,000", "₹2,000", "₹5,000"]);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radios[2]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Pay (test)" }));
    await waitFor(() => expect(topup).toHaveBeenCalledWith(200_000));
    expect(await within(sheet).findByRole("status")).toHaveTextContent("Added to your balance.");
    expect(refresh).toHaveBeenCalled();
  });
  it("closes with Escape and with Close", () => {
    render(<BillingV6 {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows the refusal in words", async () => {
    render(<BillingV6 {...props({ actions: { freeStart: async () => ({ ok: true }), topup: async () => ({ ok: false, error: "Only the owner can do this." }) } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay (test)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can do this.");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("where no top-up exists yet there is no Pay button, only the reason", () => {
    render(<BillingV6 {...props({ balance: parseBillingBalance({ ...WIRE, topup_available: false }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("Nothing is charged until then");
    expect(within(sheet).queryByRole("button", { name: "Pay (test)" })).toBeNull();
  });
});
