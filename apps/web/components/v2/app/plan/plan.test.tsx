import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CATALOGUE, callsPlans, mainPlans, planById } from "@/lib/plan/catalogue";
import { toWorkspacePlan, FRESH, type MockState } from "@/lib/plan/mock";
import type { PlanResult, WorkspacePlan } from "@/lib/plan/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";

import { PlanPicker } from "./PlanPicker";
import { PlanSection } from "./PlanSection";
import type { PlanActions } from "./types";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("plan.") || k === "frame.notyet"));
const NOW = Date.parse("2026-10-25T06:00:00Z");
const ok = async (): Promise<PlanResult> => ({ ok: true });
const actions = (over: Partial<PlanActions> = {}): PlanActions => ({ start: vi.fn(ok), cancel: vi.fn(ok), fix: vi.fn(ok), endTrial: null, ...over });
const plan = (m: Partial<MockState>): WorkspacePlan => toWorkspacePlan({ ...FRESH, ...m }, new Date(NOW));
const draw = (p: WorkspacePlan | null, over: Partial<{ canChange: boolean; mock: boolean; a: PlanActions }> = {}) =>
  render(<PlanSection words={words} plan={p} def={planById(p?.planId ?? null)} trialDays={CATALOGUE.trial.days} now={NOW} canChange={over.canChange ?? true} mock={over.mock ?? true} pickerHref="/app/tenants/t/plans" contactEmail="billing@example.test" actions={over.a ?? actions()} />);

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("Settings > Plan", () => {
  it("says 'Not available yet' when the plan cannot be read (never a guess)", () => {
    draw(null);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("no plan yet: says how the trial starts and offers to start it", () => {
    draw(plan({}));
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(screen.getByText(/If you cancel before the trial ends, nothing is charged/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`The ${CATALOGUE.trial.days} days count from the day your WhatsApp is connected`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `Start ${CATALOGUE.trial.days}-day trial` })).toHaveAttribute("href", "/app/tenants/t/plans");
    // no plan yet: the trial's allowances apply, as the API says, and nothing is used
    expect(within(document.querySelector('[data-meter="minutes"]') as HTMLElement).getByText("0 of 30")).toBeInTheDocument();
    expect(within(document.querySelector('[data-meter="messages"]') as HTMLElement).getByText("0 of 100")).toBeInTheDocument();
  });
  it("waiting for WhatsApp (trial_pending): says the days start when WhatsApp is connected, that nothing is charged, and no day count; the owner may still cancel (job DO)", () => {
    const w: WorkspacePlan = { ...plan({ state: "trialing", plan: "growth", method: "test_ok", day: 1 }), state: "trial_pending", trialEndsAt: null };
    draw(w);
    expect(document.querySelector("[data-plan-state='trial_pending']")).not.toBeNull();
    expect(screen.getByText(`Your ${CATALOGUE.trial.days} days start when WhatsApp is connected.`)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged until then/)).toBeInTheDocument();
    expect(screen.getByText("Waiting for WhatsApp")).toBeInTheDocument();
    expect(screen.queryByText(/of your trial/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel trial" })).toBeInTheDocument();
  });
  it("in the trial: the plan, the day, the days left, and both meters as counts and percentages", () => {
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok", day: 4, minutes: 6, messages: 25 }));
    expect(screen.getByText("Plan: Growth")).toBeInTheDocument();
    expect(screen.getByText(`Day 4 of ${CATALOGUE.trial.days} of your trial`)).toBeInTheDocument();
    expect(screen.getByText(`${CATALOGUE.trial.days - 3} days left`)).toBeInTheDocument();
    expect(screen.getByText("Price coming soon")).toBeInTheDocument();
    const minutes = within(document.querySelector('[data-meter="minutes"]') as HTMLElement);
    expect(minutes.getByText("6 of 30")).toBeInTheDocument();
    expect(minutes.getByText(/20% used/)).toBeInTheDocument();
    const messages = within(document.querySelector('[data-meter="messages"]') as HTMLElement);
    expect(messages.getByText("25 of 100")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("says '1 day left' in the singular on the last day", () => {
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok", day: CATALOGUE.trial.days }));
    expect(screen.getByText("1 day left")).toBeInTheDocument();
  });
  it("one gentle notice at 80, naming the meter; nothing below it", () => {
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok", day: 9, minutes: 5, messages: 80 }));
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("You have used 80% of your WhatsApp messages.");
    expect(note).toHaveTextContent("Everything else keeps working");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("all used: calls and the messages the business starts pause; quotes, orders and customers keep working", () => {
    draw(plan({ state: "active", plan: "growth", method: "test_ok", minutes: 100, messages: 400 }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Calls and announcements are paused");
    expect(alert).toHaveTextContent("Quotes, orders, follow-ups and your customers keep working as usual");
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector('[data-meter="minutes"]')).toHaveAttribute("data-state", "paused");
    expect(screen.getByText("When everything is used up")).toBeInTheDocument();
  });
  it("the explainer of what happens at the limit is always on the page", () => {
    draw(plan({ state: "trialing", plan: "starter", method: "test_ok" }));
    expect(screen.getByText("When everything is used up")).toBeInTheDocument();
    expect(screen.getByText(/Quotes, orders, follow-ups and your customers never stop/)).toBeInTheDocument();
  });
  it("a plan without minutes says 'Not included' and shows no bar for them; one with no cap says you pay for what you use", () => {
    draw(plan({ state: "active", plan: "starter", method: "test_ok", minutes: 0, messages: 10 }));
    expect(within(document.querySelector('[data-meter="minutes"]') as HTMLElement).getByText("Not included in this plan.")).toBeInTheDocument();
    expect(within(document.querySelector('[data-meter="minutes"]') as HTMLElement).queryByRole("meter")).toBeNull();
    cleanup();
    draw(plan({ state: "active", plan: "calls_payg", method: "test_ok", minutes: 42 }));
    expect(within(document.querySelector('[data-meter="minutes"]') as HTMLElement).getByText("42 used. You pay for what you use.")).toBeInTheDocument();
  });
  it("pay as you go: both meters have no ceiling (minutes and messages are paid for as used)", () => {
    draw(plan({ state: "active", plan: "calls_payg", method: "test_ok", minutes: 42, messages: 7 }));
    expect(within(document.querySelector('[data-meter="messages"]') as HTMLElement).getByText("7 used. You pay for what you use.")).toBeInTheDocument();
  });
  it("calls-only plan with messages: a real messages meter and its 80% notice", () => {
    draw(plan({ state: "active", plan: "calls_300", method: "test_ok", minutes: 10, messages: 240 }));
    expect(within(document.querySelector('[data-meter="messages"]') as HTMLElement).getByText("240 of 300")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You have used 80% of your WhatsApp messages.");
  });
  it("read-only (the trial ended unpaid): says so first with the dates, shows the meters to look at, and offers no change, cancel or start", () => {
    draw(plan({ state: "cancelled", plan: "growth", method: "test_ok", day: 30, readOnly: true }));
    expect(document.querySelector("[data-plan-access]")).toHaveAttribute("data-plan-access", "read_only");
    const box = within(document.querySelector("[data-readonly]") as HTMLElement);
    expect(box.getByText("Your workspace is read-only")).toBeInTheDocument();
    expect(box.getByText(/look at everything and export it/)).toBeInTheDocument();
    expect(box.getByText(/Read-only since \d{1,2} \w{3} 2026\./)).toBeInTheDocument();
    expect(box.getByText(/Your data is kept until .* and then deleted\. Days left: 90\./)).toBeInTheDocument();
    expect(box.getByText("To go on, write to billing@example.test.")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.queryByText("Your plan was cancelled.")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector('[data-meter="minutes"]')).not.toBeNull();
  });
  it("read-only is told apart from a plain cancelled plan (access full)", () => {
    draw(plan({ state: "cancelled", plan: "growth", method: "test_ok", day: 6, cancelled: true }));
    expect(document.querySelector("[data-readonly]")).toBeNull();
    expect(screen.getByText("Your trial was cancelled. Nothing was charged.")).toBeInTheDocument();
  });
  it("past due: the failed payment, and the one move out of it", async () => {
    const a = actions();
    draw(plan({ state: "past_due", plan: "growth", method: "test_fails" }), { a });
    expect(screen.getByRole("alert")).toHaveTextContent("Your last payment did not go through");
    fireEvent.click(screen.getByRole("button", { name: "Update payment method" }));
    await waitFor(() => expect(a.fix).toHaveBeenCalledOnce());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("a failed payment names the day it can be put right by; where the provider has no such move there is no button for it", () => {
    draw(plan({ state: "past_due", plan: "growth", method: "test_fails" }), { a: actions({ fix: null }) });
    expect(screen.getByText("Please put it right by 1 Nov 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update payment method" })).toBeNull();
  });
  it("a paid plan that was cancelled says when it ends and offers no second cancel", () => {
    draw(plan({ state: "active", plan: "growth", method: "test_ok", cancelled: true }));
    expect(screen.getByText(/Your plan ends on 24 Nov 2026\. It will not renew\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
  });
  it("a cancelled trial cannot start another (once per workspace): the link only goes to the plans", () => {
    draw(plan({ state: "cancelled", plan: "growth", method: "test_ok", cancelled: true }));
    expect(screen.queryByRole("link", { name: `Start ${CATALOGUE.trial.days}-day trial` })).toBeNull();
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "/app/tenants/t/plans");
  });
  it("cancelling in the trial asks once and says nothing is charged; 'Keep it' does nothing", async () => {
    const a = actions();
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok", day: 2 }), { a });
    fireEvent.click(screen.getByRole("button", { name: "Cancel trial" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Cancel your trial? Nothing will be charged.");
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(a.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel trial" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(a.cancel).toHaveBeenCalledOnce());
  });
  it("a trial cancelled before it ends says nothing was charged", () => {
    draw(plan({ state: "cancelled", plan: "growth", method: "test_ok", cancelled: true }));
    expect(screen.getByText("Your trial was cancelled. Nothing was charged.")).toBeInTheDocument();
  });
  it("a refused move shows our sentence, never the code", async () => {
    const a = actions({ fix: async () => ({ ok: false, error: "not_available" }) });
    draw(plan({ state: "past_due", plan: "growth", method: "test_fails" }), { a });
    fireEvent.click(screen.getByRole("button", { name: "Update payment method" }));
    expect(await screen.findByRole("alert", { name: "" })).toBeDefined();
    await waitFor(() => expect(screen.getByText("Not available yet.")).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
  it("test mode: the label, and a button that jumps to the last day only when the page gives it", async () => {
    const endTrial = vi.fn(ok);
    draw(plan({ state: "trialing", plan: "growth", method: "test_fails" }), { a: actions({ endTrial }) });
    expect(screen.getByRole("note")).toHaveTextContent("no real payment is taken and no card details are asked for");
    fireEvent.click(screen.getByRole("button", { name: "Test only: jump to the last day" }));
    await waitFor(() => expect(endTrial).toHaveBeenCalled());
    cleanup();
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok" }), { mock: false });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("button", { name: /jump to the last day/ })).toBeNull();
  });
  it("a person who may not change the plan sees the plan and the meters but no move", () => {
    draw(plan({ state: "trialing", plan: "growth", method: "test_ok" }), { canChange: false });
    expect(screen.getByText("Plan: Growth")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /plan/i })).toBeNull();
  });
  it("never a rupee sign, a price or the word token on the screen", () => {
    const { container } = draw(plan({ state: "active", plan: "business", method: "test_ok", minutes: 250, messages: 2500 }));
    expect(container.textContent).not.toMatch(/₹|rupee|\btokens?\b|\bRs\b/i);
  });
});

describe("the plan picker", () => {
  const pick = (over: Partial<{ canStart: boolean; currentId: string | null; blocked: "already" | "used" | "forbidden" | null; a: PlanActions }> = {}) =>
    render(<PlanPicker words={words} main={mainPlans()} calls={callsPlans()} currentId={over.currentId ?? null} canStart={over.canStart ?? true} blocked={over.blocked ?? null} mock trialDays={CATALOGUE.trial.days} actions={over.a ?? actions()} done="/app/tenants/t/settings?section=plan" />);

  it("Calls 300 and Calls 1,000 include WhatsApp follow-up messages; pay-as-you-go pays per message", () => {
    pick();
    const row = (id: string) => (document.querySelector(`[data-plan="${id}"]`) as HTMLElement).textContent ?? "";
    expect(row("calls_300")).toMatch(/WhatsApp messages you start, a month\s*300/);
    expect(row("calls_1000")).toMatch(/WhatsApp messages you start, a month\s*1,000/);
    expect(row("calls_payg")).toMatch(/WhatsApp messages you start, a month\s*Pay for the messages you send/);
  });
  it("compares the six plans from the data, every price 'Price coming soon'", () => {
    pick();
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Starter", "Growth", "Business", "Pay-as-you-go", "Calls 300", "Calls 1,000"]);
    expect(screen.getAllByText("Price coming soon")).toHaveLength(6);
    const growth = within(document.querySelector('[data-plan="growth"]') as HTMLElement);
    expect(growth.getByText("100")).toBeInTheDocument();
    expect(growth.getByText("1,000")).toBeInTheDocument();
    const starter = within(document.querySelector('[data-plan="starter"]') as HTMLElement);
    expect(starter.getByText("Not included")).toBeInTheDocument();
    expect(within(document.querySelector('[data-plan="calls_payg"]') as HTMLElement).getByText("Pay for the minutes you use")).toBeInTheDocument();
    expect(screen.getByText(/your AI team \(fair use\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/₹|\btokens?\b/i);
  });
  it("starting needs a plan and a payment method; the refusal is in our words and nothing starts", async () => {
    const a = actions({ start: vi.fn(async (_p: string, m: string): Promise<PlanResult> => (m ? { ok: true } : { ok: false, error: "no_payment_method" })) });
    pick({ a });
    expect(screen.getByRole("button", { name: "Start trial" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio", { name: `Start the ${CATALOGUE.trial.days}-day trial of Growth` })[0]);
    fireEvent.click(screen.getByRole("button", { name: `Start the ${CATALOGUE.trial.days}-day trial of Growth` }));
    expect(await screen.findByText("Choose a payment method to start the trial.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Test card that works" }));
    fireEvent.click(screen.getByRole("button", { name: `Start the ${CATALOGUE.trial.days}-day trial of Growth` }));
    await waitFor(() => expect(a.start).toHaveBeenLastCalledWith("growth", "test_ok"));
    expect(await screen.findByText(new RegExp(`Your ${CATALOGUE.trial.days}-day trial of Growth has started`))).toBeInTheDocument();
  });
  it("offers the three test payment choices, one of them refused at once with its own sentence", async () => {
    const a = actions({ start: vi.fn(async (_p: string, m: string): Promise<PlanResult> => (m === "test_declined" ? { ok: false, error: "declined" } : { ok: true })) });
    pick({ a });
    expect(screen.getAllByRole("radio", { name: /^Test card/ })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("radio", { name: `Start the ${CATALOGUE.trial.days}-day trial of Business` })[0]);
    fireEvent.click(screen.getByRole("radio", { name: "Test card that is declined at once" }));
    fireEvent.click(screen.getByRole("button", { name: `Start the ${CATALOGUE.trial.days}-day trial of Business` }));
    expect(await screen.findByText("The payment method was declined, so the trial did not start.")).toBeInTheDocument();
  });
  it("a workspace whose trial is over, or a person who is not the Owner, is told why and cannot start", () => {
    pick({ canStart: false, blocked: "used" });
    expect(screen.getByText("The free trial can be started only once for a workspace.")).toBeInTheDocument();
    cleanup();
    pick({ canStart: false, blocked: "forbidden" });
    expect(screen.getByText("Only the Owner can change the plan.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
  it("a business that has a plan sees its own plan marked and no way to start another", () => {
    pick({ canStart: false, currentId: "growth", blocked: "already" });
    expect(within(document.querySelector('[data-plan="growth"]') as HTMLElement).getByText("Your plan")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
    expect(screen.getByText("You already have a plan.")).toBeInTheDocument();
  });
});
