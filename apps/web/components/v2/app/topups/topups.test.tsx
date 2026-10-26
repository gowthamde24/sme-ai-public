import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./LazyTopups", async () => ({ TopupControls: (await import("./TopupControls")).TopupControls }));

import { appDict } from "@/i18n/app";
import { FRESH, buyPack, mockTopups, mockUsage, type MockState } from "@/lib/topups/mock";
import type { PreviewResult, TopupResult } from "@/lib/topups/types";

import { NeedsYouTopup } from "./NeedsYouTopup";
import { TopupBanner } from "./TopupBanner";
import { TopupControls } from "./TopupControls";
import { TopupHistory } from "./TopupHistory";
import { TopupSection } from "./TopupSection";
import { UsageBars } from "./UsageBars";
import { WaitingCard } from "./WaitingCard";
import type { TopupActions } from "./types";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tu.") || k === "frame.notyet"));
const NOW = new Date("2026-10-06T10:00:00+05:30");
const ID = "77777777-7777-4777-8777-777777777777";
const state = (over: Partial<MockState> = {}): MockState => ({ ...FRESH(NOW), ...over });
const usageAt = (um: number | null, over: Partial<MockState> = {}) => mockUsage(state({ um, ...over }), "calls_300", NOW);
const view = (over: Partial<MockState> = {}) => mockTopups(state(over), "calls_300", NOW);
const ok = async (): Promise<TopupResult> => ({ ok: true });
const actions = (over: Partial<TopupActions> = {}): TopupActions => ({ buy: vi.fn(ok), save: vi.fn(ok), preview: vi.fn(async (): Promise<PreviewResult> => ({ ok: false, error: "not_an_upgrade" })), upgrade: vi.fn(ok), simulate: null, ...over });

beforeEach(() => vi.stubGlobal("crypto", { randomUUID: () => ID }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("the two bars", () => {
  it("minutes and messages: used of total, the percentage, what is left, the plan part and the top-up part, the run-out day, the expiry of unused top-ups", () => {
    const s = (buyPack(state({ um: 241.5 }), ID, "minutes_100", NOW) as { next: MockState }).next;
    render(<UsageBars words={words} usage={mockUsage(s, "calls_300", NOW)} />);
    const min = within(document.querySelector('[data-meter="tu-minutes"]') as HTMLElement);
    expect(min.getByText("241.5 of 400 used")).toBeInTheDocument();
    expect(min.getByText("60% used · 158.5 left")).toBeInTheDocument();
    expect(min.getByText("Plan: 300. Top-ups left: 100.")).toBeInTheDocument();
    expect(min.getByText("At this pace it runs out on 9 Oct.")).toBeInTheDocument();
    expect(min.getByText("Unused top-up units stay until 4 Jan, then they expire.")).toBeInTheDocument();
    expect(min.getByRole("meter")).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("This month: 1 Oct to 31 Oct. 26 days left.")).toBeInTheDocument();
    const msg = within(document.querySelector('[data-meter="tu-messages"]') as HTMLElement);
    expect(msg.getByText("120 of 300 used")).toBeInTheDocument();
  });
  it("used up: says calls wait in a queue; no run-out date", () => {
    render(<UsageBars words={words} usage={usageAt(300)} />);
    const min = within(document.querySelector('[data-meter="tu-minutes"]') as HTMLElement);
    expect(document.querySelector('[data-meter="tu-minutes"]')).toHaveAttribute("data-state", "stopped");
    expect(min.getByText(/New calls wait in a queue/)).toBeInTheDocument();
    expect(min.queryByText(/runs out on/)).toBeNull();
  });
  it("pay as you go: counts only, no bar; a plan without the thing: says so", () => {
    render(<UsageBars words={words} usage={mockUsage(state({ um: 90 }), "calls_payg", NOW)} />);
    expect(screen.getByText("90 used. This plan has no limit; you pay for what you use.")).toBeInTheDocument();
    cleanup();
    render(<UsageBars words={words} usage={mockUsage(state({ um: 0 }), "starter", NOW)} />);
    expect(screen.getByText("Not included in your plan. A top-up still works.")).toBeInTheDocument();
  });
  it("never shows a rupee or a token for the AI", () => {
    render(<UsageBars words={words} usage={usageAt(300)} />);
    expect(document.body.textContent).not.toMatch(/token|₹/i);
  });
});

describe("the notice at 80 and at 100 percent", () => {
  it("draws nothing below 80 percent", () => {
    const { container } = render(<TopupBanner words={words} usage={usageAt(100)} href="/h" canBuy />);
    expect(container).toBeEmptyDOMElement();
    const n = render(<NeedsYouTopup words={words} usage={usageAt(100)} href="/h" canBuy />);
    expect(n.container).toBeEmptyDOMElement();
  });
  it("80 percent: a status line with how far it is and the day it runs out; a button to top up", () => {
    render(<TopupBanner words={words} usage={usageAt(null)} href="/app/tenants/t/settings?section=plan#topups" canBuy />);
    const b = screen.getByRole("status");
    expect(b).toHaveAttribute("data-topup-banner", "80");
    expect(b).toHaveTextContent("Your calls are at 80% of this month's minutes. At this pace they run out on 7 Oct.");
    expect(screen.getByRole("link", { name: "Top up" })).toHaveAttribute("href", "/app/tenants/t/settings?section=plan#topups");
  });
  it("100 percent: an alert saying calls are queued and how many wait; an Admin is offered 'See usage', not 'Top up'", () => {
    render(<TopupBanner words={words} usage={usageAt(300)} href="/h" canBuy={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your minutes are used up. Calls are queued (12 waiting). Top up to continue.");
    expect(screen.getByRole("link", { name: "See usage" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Top up" })).toBeNull();
  });
  it("messages used up come before minutes at 80", () => {
    render(<TopupBanner words={words} usage={mockUsage(state({ um: 241.5, ug: 300 }), "calls_300", NOW)} href="/h" canBuy />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your WhatsApp messages are used up. Messages you start are held in the outbox (6 held).");
  });
  it("the 'Needs you' card: a badge, a title, what it means, the run-out day and one button", () => {
    render(<NeedsYouTopup words={words} usage={usageAt(null)} href="/h" canBuy />);
    const card = document.querySelector("[data-topup-needs]") as HTMLElement;
    expect(card).toHaveAttribute("data-topup-needs", "80");
    expect(within(card).getByText("Needs you")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Call minutes are running low" })).toBeInTheDocument();
    expect(within(card).getByText("At this pace they run out on 7 Oct.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Top up" })).toBeInTheDocument();
    cleanup();
    render(<NeedsYouTopup words={words} usage={usageAt(300)} href="/h" canBuy />);
    expect(screen.getByRole("heading", { name: "Call minutes are used up" })).toBeInTheDocument();
    expect(screen.getByText(/12 leads wait for a call/)).toBeInTheDocument();
  });
});

describe("leads waiting for calls", () => {
  it("'12 leads waiting for calls · Top up', and what stays true meanwhile", () => {
    render(<WaitingCard words={words} waiting={12} href="/h" canBuy />);
    const h = screen.getByRole("heading", { level: 2 });
    expect(h).toHaveTextContent("12 leads waiting for calls · Top up");
    expect(within(h).getByRole("link", { name: "Top up" })).toHaveAttribute("href", "/h");
    expect(screen.getByText(/start again by themselves after a top-up or when the new month begins/)).toBeInTheDocument();
    expect(screen.getByText(/Leads are still captured, and free WhatsApp replies within 24 hours carry on/)).toBeInTheDocument();
  });
  it("one lead; nothing at all when none wait", () => {
    render(<WaitingCard words={words} waiting={1} href="/h" canBuy={false} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 lead waiting for a call · See usage");
    cleanup();
    const { container } = render(<WaitingCard words={words} waiting={0} href="/h" canBuy />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("bought and invoices", () => {
  it("nothing yet", () => {
    render(<TopupHistory words={words} history={[]} invoices={[]} />);
    expect(screen.getByText("Nothing bought yet.")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
  });
  it("a purchase and its fake invoice with the GST fields (IGST when no GSTIN is set)", () => {
    const s = (buyPack(state(), ID, "minutes_300", NOW) as { next: MockState }).next;
    const v = mockTopups(s, "calls_300", NOW);
    render(<TopupHistory words={words} history={v.history} invoices={v.invoices} />);
    const p = within(document.querySelector('[data-purchase="minutes_300"]') as HTMLElement);
    expect(p.getByText("+300 minutes")).toBeInTheDocument();
    expect(p.getByText(/₹1,274\.40 · bought by you/)).toBeInTheDocument();
    expect(p.getByText(/300 left, expires 4 Jan 2027/)).toBeInTheDocument();
    const i = within(document.querySelector("[data-invoice]") as HTMLElement);
    expect(i.getByText(/S19-2610-000001/)).toBeInTheDocument();
    expect(i.getByText("₹1,080")).toBeInTheDocument();
    expect(i.getByText("IGST (18%)")).toBeInTheDocument();
    expect(i.getByText("₹194.40")).toBeInTheDocument();
    expect(i.getByText("Your GSTIN: not set (add it in Settings > Business)")).toBeInTheDocument();
    expect(screen.getByText("These are test invoices, not real tax invoices.")).toBeInTheDocument();
  });
  it("CGST and SGST for the same state", () => {
    const v = view();
    const inv = { ...mockTopups((buyPack(state(), ID, "minutes_300", NOW) as { next: MockState }).next, "calls_300", NOW).invoices[0], cgstPaise: 9720, sgstPaise: 9720, igstPaise: 0, buyerGstin: "36ABCDE1234F1Z5" };
    render(<TopupHistory words={words} history={v.history} invoices={[inv]} />);
    expect(screen.getByText("CGST (9%)")).toBeInTheDocument();
    expect(screen.getByText("SGST (9%)")).toBeInTheDocument();
    expect(screen.queryByText(/IGST/)).toBeNull();
    expect(screen.getByText("Your GSTIN: 36ABCDE1234F1Z5")).toBeInTheDocument();
  });
});

const controls = (a: TopupActions, over: Partial<{ canChange: boolean; readOnly: boolean; mock: boolean; upgrades: { id: string; name: string }[] }> = {}) => {
  const v = view();
  return render(<TopupControls words={words} packs={v.packs} settings={v.settings} upgrades={over.upgrades ?? [{ id: "calls_1000", name: "Lead Desk 1,000" }]} currentName="Lead Desk 300" canChange={over.canChange ?? true} readOnly={over.readOnly ?? false} mock={over.mock ?? true} actions={a} />);
};

describe("buying a pack", () => {
  it("six buttons (+100, +300, +1,000 of each), the price from the pack marked as a test price, and the 90 days said", () => {
    controls(actions());
    for (const code of ["minutes_100", "minutes_300", "minutes_1000", "messages_100", "messages_300", "messages_1000"]) expect(document.querySelector(`[data-pack="${code}"]`)).not.toBeNull();
    const b = within(document.querySelector('[data-pack="minutes_300"]') as HTMLElement);
    expect(b.getByText("+300 minutes")).toBeInTheDocument();
    expect(b.getByText("test price ₹1,274.40 with GST")).toBeInTheDocument();
    expect(screen.getByText(/Unused top-up units carry over for 90 days/)).toBeInTheDocument();
    expect(screen.getByText("Your plan's allowance is used first, then the oldest top-up.")).toBeInTheDocument();
  });
  it("a real (non-placeholder) price is written without 'test'", () => {
    const v = view();
    render(<TopupControls words={words} packs={v.packs.map((p) => ({ ...p, isPlaceholder: false }))} settings={v.settings} upgrades={[]} currentName={null} canChange readOnly={false} mock={false} actions={actions()} />);
    expect(screen.getByText("₹1,274.40 with GST")).toBeInTheDocument();
  });
  it("opens the checkout sheet: marked TEST, 'No money is taken', no field for a UPI id or card number, the amounts", () => {
    controls(actions());
    fireEvent.click(document.querySelector('[data-pack="minutes_300"]') as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: "Pay for +300 minutes" });
    expect(within(dialog).getByText("TEST")).toBeInTheDocument();
    expect(within(dialog).getByText("No money is taken. This is a test payment sheet.")).toBeInTheDocument();
    expect(within(dialog).getByText("₹1,080")).toBeInTheDocument();
    expect(within(dialog).getByText("GST (18%)")).toBeInTheDocument();
    expect(within(dialog).getByText("₹1,274.40")).toBeInTheDocument();
    expect(within(dialog).getByText("No UPI ID or card number is asked for.")).toBeInTheDocument();
    expect(dialog.querySelectorAll("input:not([type=radio])")).toHaveLength(0);
    expect(within(dialog).getAllByRole("radio").map((r) => r.parentElement?.textContent)).toEqual(["UPI (test)", "Card (test)", "Test: make this payment fail"]);
  });
  it("paying sends the pack, the id the browser made and the test outcome; then says done and refreshes the screen", async () => {
    const a = actions();
    controls(a);
    fireEvent.click(document.querySelector('[data-pack="messages_100"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹82.60 (test)" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Done: +100 messages."));
    expect(a.buy).toHaveBeenCalledWith(ID, "messages_100", "test_ok");
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a payment made to fail says so; trying again keeps the SAME purchase id (never two purchases)", async () => {
    const buy = vi.fn<TopupActions["buy"]>().mockResolvedValueOnce({ ok: false, error: "declined" }).mockResolvedValueOnce({ ok: true });
    controls(actions({ buy }));
    fireEvent.click(document.querySelector('[data-pack="minutes_100"]') as HTMLElement);
    fireEvent.click(screen.getByLabelText("Test: make this payment fail"));
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The test payment was declined, so nothing was added."));
    expect(buy).toHaveBeenLastCalledWith(ID, "minutes_100", "test_declined");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("UPI (test)"));
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(buy).toHaveBeenLastCalledWith(ID, "minutes_100", "test_ok");
  });
  it("the second factor is asked for with a way to Security; Cancel and Escape close the sheet", async () => {
    controls(actions({ buy: vi.fn(async (): Promise<TopupResult> => ({ ok: false, error: "mfa" })) }));
    fireEvent.click(document.querySelector('[data-pack="minutes_100"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(document.querySelector('[data-pack="minutes_100"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("auto top-up and pay per use", () => {
  it("both are OFF by default, with no limit fields showing", () => {
    controls(actions());
    expect(screen.getByRole("switch", { name: /Top up by itself/ })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /Pay per minute/ })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /Pay per message/ })).not.toBeChecked();
    expect(screen.queryByLabelText(/Monthly limit/)).toBeNull();
  });
  it("turning auto top-up on offers the packs and a monthly limit; it needs a pack and a limit; saves the whole object in paise", async () => {
    const a = actions();
    controls(a);
    fireEvent.click(screen.getByRole("switch", { name: /Top up by itself/ }));
    fireEvent.change(screen.getByLabelText("Pack for minutes"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a pack to buy, or turn auto top-up off.");
    fireEvent.change(screen.getByLabelText("Pack for minutes"), { target: { value: "minutes_100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a monthly limit in rupees above zero.");
    expect(a.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Monthly limit in rupees (with GST)"), { target: { value: "2,000" } });
    fireEvent.click(screen.getByRole("switch", { name: /Pay per message/ }));
    fireEvent.change(screen.getByLabelText("Monthly limit in rupees"), { target: { value: "500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect(a.save).toHaveBeenCalledWith({ autoMinutesPack: "minutes_100", autoMessagesPack: null, autoMonthlyCapPaise: 200000, overageMinutes: false, overageMessages: true, overageMonthlyCapPaise: 50050 });
  });
  it("a limit that is not an amount is refused before it is sent; the test rate is labelled in test mode", () => {
    const a = actions();
    controls(a);
    fireEvent.click(screen.getByRole("switch", { name: /Pay per minute/ }));
    expect(screen.getByText("Test rate: ₹5 a minute, ₹0.70 a message.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Monthly limit in rupees"), { target: { value: "lots" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Something is not right in what you entered");
    expect(a.save).not.toHaveBeenCalled();
  });
  it("a refusal from the server (the second factor) is said", async () => {
    controls(actions({ save: vi.fn(async (): Promise<TopupResult> => ({ ok: false, error: "mfa" })) }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Confirm with your second step first"));
  });
});

describe("upgrading in the middle of the month", () => {
  const preview = (over = {}): PreviewResult => ({ ok: true, preview: { fromPlanId: "calls_300", toPlanId: "calls_1000", priceSet: true, daysInPeriod: 31, daysLeft: 26, proratedPaise: 209677, gstPaise: 37742, totalPaise: 247419, newAllowances: { callMinutes: 1000, messages: 1000 }, effective: "now", ...over } });
  it("choose a plan, see the difference (the days left, GST, the total), the new allowance from now, and that the month does not move", async () => {
    const a = actions({ preview: vi.fn(async () => preview()) });
    controls(a);
    expect(screen.getByRole("button", { name: "See the difference" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "calls_1000" } });
    fireEvent.click(screen.getByRole("button", { name: "See the difference" }));
    await screen.findByText("These amounts are test prices.");
    const box = document.querySelector("[data-upgrade-preview]") as HTMLElement;
    expect(a.preview).toHaveBeenCalledWith("calls_1000");
    expect(within(box).getByText("Difference for the 26 days left (of 31)")).toBeInTheDocument();
    expect(within(box).getByText("₹2,096.77")).toBeInTheDocument();
    expect(within(box).getByText("₹2,474.19")).toBeInTheDocument();
    expect(within(box).getByText("New allowance from now: 1,000 call minutes and 1,000 messages.")).toBeInTheDocument();
    expect(within(box).getByText("The month does not move: the period dates stay the same.")).toBeInTheDocument();
    expect(within(box).getByText("These amounts are test prices.")).toBeInTheDocument();
  });
  it("upgrading goes through the test checkout sheet and then says done", async () => {
    const a = actions({ preview: vi.fn(async () => preview()) });
    controls(a);
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "calls_1000" } });
    fireEvent.click(screen.getByRole("button", { name: "See the difference" }));
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to Lead Desk 1,000" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("No money is taken");
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹2,474.19 (test)" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Done: Lead Desk 1,000."));
    expect(a.upgrade).toHaveBeenCalledWith("calls_1000", "test_ok");
  });
  it("a plan with no price set: says the price is set at launch, the new allowance still starts now; the upgrade costs nothing yet", async () => {
    controls(actions({ preview: vi.fn(async () => preview({ priceSet: false, proratedPaise: null, gstPaise: null, totalPaise: null })) }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "calls_1000" } });
    fireEvent.click(screen.getByRole("button", { name: "See the difference" }));
    expect(await screen.findByText(/set at launch, so there is no amount to pay yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Lead Desk 1,000" }));
    expect(screen.getByRole("button", { name: "Upgrade now (test)" })).toBeInTheDocument();
  });
  it("no bigger plan: says so; a refused preview says why", async () => {
    controls(actions(), { upgrades: [] });
    expect(screen.getByText("There is no bigger plan to move to.")).toBeInTheDocument();
    cleanup();
    controls(actions());
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "calls_1000" } });
    fireEvent.click(screen.getByRole("button", { name: "See the difference" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That plan is not a step up from your plan.");
  });
});

describe("who can do what", () => {
  it("an Admin sees a note instead of the buttons; a read-only workspace says it is read-only", () => {
    controls(actions(), { canChange: false });
    expect(screen.getByText("Only the owner can buy top-ups or change these settings.")).toBeInTheDocument();
    expect(document.querySelector("[data-pack]")).toBeNull();
    cleanup();
    controls(actions(), { readOnly: true });
    expect(screen.getByText("Your workspace is read-only, so this is switched off.")).toBeInTheDocument();
    expect(document.querySelector("[data-pack]")).toBeNull();
  });
  it("the test controls exist only when the page passes them", async () => {
    controls(actions());
    expect(document.querySelector('[data-topups="simulate"]')).toBeNull();
    cleanup();
    const simulate = vi.fn(ok);
    controls(actions({ simulate }));
    fireEvent.click(screen.getByRole("button", { name: "Set to 100%" }));
    await waitFor(() => expect(simulate).toHaveBeenCalledWith(100));
    fireEvent.click(screen.getByRole("button", { name: "New month" }));
    await waitFor(() => expect(simulate).toHaveBeenCalledWith(0));
  });
});

describe("the whole part", () => {
  const section = (over: Partial<Parameters<typeof TopupSection>[0]> = {}) =>
    render(<TopupSection words={words} view={view({ um: 300 })} canChange mock upgrades={[]} currentName="Lead Desk 300" actions={actions()} topupHref="/h" readOnly={false} {...over} />);
  it("title, the test-mode note, the bars, the alert, the waiting leads, the controls and the record", () => {
    section();
    expect(screen.getByRole("heading", { name: "Usage and top-ups" })).toBeInTheDocument();
    expect(screen.getByText(/Test mode: no money is taken/)).toBeInTheDocument();
    expect(document.querySelector('[data-meter="tu-minutes"]')).not.toBeNull();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Your minutes are used up");
    expect(document.querySelector('[data-topup-waiting="12"]')).not.toBeNull();
    expect(document.querySelector('[data-topups="controls"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Bought and invoices" })).toBeInTheDocument();
    expect(screen.getByText(/AI itself is included \(fair use\)/)).toBeInTheDocument();
  });
  it("says 'Not available yet' when it cannot be read; no test note outside test mode", () => {
    section({ view: null });
    expect(screen.getByText("Not available yet.")).toBeInTheDocument();
    cleanup();
    section({ mock: false, view: view({ um: 100 }) });
    expect(screen.queryByText(/Test mode/)).toBeNull();
    expect(document.querySelector("[data-topup-waiting]")).toBeNull();
  });
});
