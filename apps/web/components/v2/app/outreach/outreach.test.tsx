import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

import { appDict } from "@/i18n/app";
import { EMPTY, answerOf, itemsOf, newBatch, ruleOf, newRule } from "@/lib/outreach/mock";
import type { BatchAnswer, BatchInput, Done, Handoff, Rule } from "@/lib/outreach/types";
import { channelNames, goalNames, languageNames, sourceNames } from "@/lib/outreach/words";

import { BatchForm } from "./BatchForm";
import { BatchView, type BatchActions } from "./BatchView";
import { HotLeads } from "./HotLeads";
import { RulesPanel } from "./RulesPanel";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(ol|pc|ld)\./.test(k)));
const t0 = new Date("2026-10-27T10:00:00.000Z");
const input: BatchInput = { batchId: "22222222-2222-4222-8222-222222222222", name: "IndiaMART leads", goal: "site_visit", channel: "call", language: "te", who: { kind: "source", source: "indiamart", status: "new", since: null }, questions: ["What is your budget?"], messageText: null, windowDays: 7, maxCallsPerDay: 50, maxTotalMinutes: null };
const batch = newBatch(input, t0);
const planned = answerOf(batch, t0);
const ok = (value: BatchAnswer): Done<BatchAnswer> => ({ ok: true, value });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const view = (over: Partial<Parameters<typeof BatchView>[0]> = {}, actions: Partial<BatchActions> = {}) => {
  const a: BatchActions = { exclude: vi.fn(async () => ok(planned)), approve: vi.fn(async () => ok({ ...planned, batch: { ...planned.batch, status: "running" } })), control: vi.fn(async () => ok(planned)), ...actions };
  render(<BatchView words={words} initial={planned} items={itemsOf(batch, t0)} canApprove canDecide canCancel simulated channelWords={channelNames(words)} goalWord="ld.goal.site_visit" whenText="2026-10-27 to 2026-11-03, in your calling hours" actions={a} securityHref="/app/security" {...over} />);
  return a;
};

describe("one batch of leads (the plan card, then progress)", () => {
  it("shows the plan card with the goal, the questions, the estimate and ONE approve button", () => {
    view();
    expect(screen.getByText("IndiaMART leads")).toBeInTheDocument();
    expect(screen.getByText("Book a site visit")).toBeInTheDocument();
    expect(screen.getByText("What is your budget?")).toBeInTheDocument();
    expect(screen.getByText("Phone calls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`Approve all \\(${planned.plan.ready}\\)`) })).toBeEnabled();
    expect(screen.getByText(/the calls are simulated/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been called or sent/)).toBeInTheDocument();
  });
  it("approving asks the action once with the hash that was shown, then shows the progress", async () => {
    const a = view();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Approve all/ })));
    expect(a.approve).toHaveBeenCalledWith(planned.batch.planSha256);
    expect(screen.getByRole("status")).toHaveTextContent("Approved");
    expect(refresh).toHaveBeenCalled();
  });
  it("leaving a person out tells the action, counts the rest and keeps the tick off", async () => {
    const who = planned.plan.sample[0];
    const after = answerOf({ ...batch, excluded: [who.contactId] }, t0);
    const a = view({}, { exclude: vi.fn(async () => ok(after)) });
    await act(async () => void fireEvent.click(screen.getAllByRole("checkbox")[0]));
    expect(a.exclude).toHaveBeenCalledWith(who.contactId, true);
    expect(screen.getByRole("button", { name: `Approve all (${after.plan.ready})` })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
  });
  it("only Owner and Admin can leave people out: another person is told why", async () => {
    const a = view({ canDecide: false, canApprove: false });
    await act(async () => void fireEvent.click(screen.getAllByRole("checkbox")[0]));
    expect(a.exclude).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Only the Owner and Admin");
  });
  it("a plan the Owner has not looked at again says so when the hash is stale, and an approval without the second factor says so with the way to set it up", async () => {
    view({}, { approve: vi.fn(async (): Promise<Done<BatchAnswer>> => ({ ok: false, error: "mfa" })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Approve all/ })));
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/app/security");
  });
  it("a running batch shows 'N of M', a bar and pause; a paused one says why and can continue; cancel is the Owner's", async () => {
    const running = { ...batch, approvedAt: t0.toISOString() };
    const now = new Date(t0.getTime() + 9_000);
    const ans = answerOf(running, now);
    const a = view({ initial: ans, items: itemsOf(running, now) });
    expect(screen.getByText(`3 of ${ans.plan.ready} done`)).toBeInTheDocument();
    expect(document.querySelector("progress")).toHaveAttribute("value", "3");
    expect(screen.queryByRole("button", { name: /Approve all/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel this plan" })).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Pause" })));
    expect(a.control).toHaveBeenCalledWith("pause");
    cleanup();
    const paused = answerOf({ ...running, paused: true }, now);
    view({ initial: { ...paused, batch: { ...paused.batch, pausedReason: "cap_calls" } }, canCancel: false });
    expect(screen.getByText(/today's call limit was reached/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel this plan" })).toBeNull();
  });
  it("refreshes itself every few seconds while it runs, and not otherwise", () => {
    vi.useFakeTimers();
    try {
      const running = answerOf({ ...batch, approvedAt: t0.toISOString() }, t0);
      view({ initial: running });
      vi.advanceTimersByTime(9100);
      expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);
      cleanup();
      refresh.mockClear();
      view();
      vi.advanceTimersByTime(9100);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("lists everyone with why anyone is left out", () => {
    const first = planned.plan.sample[0].contactId;
    const b = { ...batch, excluded: [first] };
    view({ initial: answerOf(b, t0), items: itemsOf(b, t0) });
    const people = document.querySelector("[data-part=people]") as HTMLElement;
    expect(within(people).getAllByText("left out by you").length).toBeGreaterThan(0);
  });
});

describe("making the plan", () => {
  const draw = (plan = vi.fn<(input: unknown) => Promise<Done<BatchAnswer>>>(async () => ok(planned))) => {
    render(<BatchForm words={words} source="indiamart" sourceLabel="IndiaMART" defaultName="IndiaMART, 2026-10-27" defaultGoal="general" defaultLanguage="te" languageNames={languageNames()} goalNames={goalNames(words)} plan={plan} backHref="/app/tenants/t/outreach" today="2026-10-27" />);
    return plan;
  };
  it("sends the plan as the form says it (closed words, the source as 'who') and goes to the plan card", async () => {
    const plan = draw();
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: "Diwali" } });
    fireEvent.change(screen.getByLabelText("What should your assistant ask?"), { target: { value: "Budget?\n\nWhich area?" } });
    fireEvent.change(screen.getByLabelText("Most calls in a day (optional)"), { target: { value: "40" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Make the plan" })));
    const sent = plan.mock.calls[0][0] as BatchInput;
    expect(sent).toMatchObject({ name: "Diwali", goal: "general", channel: "call", language: "te", who: { kind: "source", source: "indiamart", status: "new", since: null }, questions: ["Budget?", "Which area?"], messageText: null, windowDays: 7, maxCallsPerDay: 40, maxTotalMinutes: null });
    expect(sent.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(push).toHaveBeenCalledWith(`/app/tenants/t/outreach/batches/${planned.batch.id}`);
  });
  it("asks for the WhatsApp words only when WhatsApp is used, and offers all six call languages", () => {
    draw();
    expect(screen.queryByLabelText("The WhatsApp message")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Phone calls and WhatsApp" }));
    expect(screen.getByLabelText("The WhatsApp message")).toBeRequired();
    expect(screen.getByRole("button", { name: "Make the plan" })).toBeDisabled();
    const options = within(screen.getByLabelText("Language of the calls and messages")).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["te", "hi", "kn", "en", "ta", "ml"]);
  });
  it("says so when the plan could not be made, and sends nothing twice", async () => {
    const plan = draw(vi.fn(async (): Promise<Done<BatchAnswer>> => ({ ok: false, error: "invalid" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Make the plan" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the plan");
    expect(push).not.toHaveBeenCalled();
    expect(plan).toHaveBeenCalledTimes(1);
  });
});

describe("standing rules", () => {
  const rule: Rule = ruleOf(newRule({ ruleId: "66666666-6666-4666-8666-666666666666", source: "website_form", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null }, t0), t0);
  const draw = (over: Partial<Parameters<typeof RulesPanel>[0]> = {}, save = vi.fn<(input: unknown) => Promise<Done<Rule>>>(async () => ({ ok: true, value: rule })), control = vi.fn(async (): Promise<Done<Rule>> => ({ ok: true, value: rule }))) => {
    render(<RulesPanel words={words} rules={[rule]} canAdd canControl sourceNames={sourceNames(words)} goalNames={goalNames(words)} languageNames={languageNames()} actions={{ save, control }} securityHref="/app/security" defaultLanguage="en" {...over} />);
    return { save, control };
  };
  it("reads a rule as one plain sentence with what it did", () => {
    draw();
    expect(screen.getByText("New leads from Your website form: call within 2 minutes, in calling hours.")).toBeInTheDocument();
    expect(screen.getByText(/leads handled/)).toBeInTheDocument();
    expect(EMPTY.rules).toEqual([]);
  });
  it("pauses and turns on again (Owner and Admin); others only read", async () => {
    const { control } = draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Pause this rule" })));
    expect(control).toHaveBeenCalledWith(rule.id, "pause");
    cleanup();
    draw({ canControl: false, canAdd: false });
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("approves a new rule ONCE, shows the sentence it will approve, and sends the closed values", async () => {
    const { save } = draw({ rules: [] });
    expect(screen.getByText(/No standing rules yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.change(screen.getByLabelText("Where the leads come from"), { target: { value: "indiamart" } });
    fireEvent.change(screen.getByLabelText("Minutes before the first call"), { target: { value: "3" } });
    expect(document.querySelector("[data-part=rule-sentence]")).toHaveTextContent("New leads from IndiaMART: call within 3 minutes, in calling hours.");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ source: "indiamart", action: "call_within_minutes", withinMinutes: 3, channel: "call", language: "en", maxCallsPerDay: 50, messageText: null });
    expect(screen.getByRole("status")).toHaveTextContent("Rule approved");
  });
  it("a rule that messages first asks for its words, and an approval without the second factor links to setting it up", async () => {
    const { save } = draw({ rules: [] }, vi.fn(async (): Promise<Done<Rule>> => ({ ok: false, error: "mfa" })));
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp first, then call" }));
    expect(screen.getByRole("button", { name: "Approve this rule" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The WhatsApp message"), { target: { value: "Hello, we will call you shortly." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toBeInTheDocument();
  });
  it("says when a rule for that source is already on", async () => {
    draw({ rules: [] }, vi.fn(async (): Promise<Done<Rule>> => ({ ok: false, error: "state" })));
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(screen.getByRole("alert")).toHaveTextContent("already a rule on");
  });
});

describe("hot leads", () => {
  const hot: Handoff = { id: "a1", leadId: null, contactId: "b1", contactName: "Ravi K.", summary: "Wants to see the site on Saturday.", assignedTo: "u", notifiedAt: "2026-10-27T05:00:00Z", reminderSentAt: null, actedAt: null };
  it("lists who is waiting with the one-line summary, and says nothing is waiting otherwise", () => {
    render(<HotLeads words={words} items={[hot, { ...hot, id: "a2", contactName: "Anitha R.", reminderSentAt: "2026-10-27T05:15:00Z" }]} acted={vi.fn()} />);
    expect(screen.getAllByText("Wants to see the site on Saturday.")).toHaveLength(2);
    expect(screen.getByText("Reminded")).toBeInTheDocument();
    cleanup();
    render(<HotLeads words={words} items={[]} acted={vi.fn()} />);
    expect(screen.getByText(/No hot leads are waiting/)).toBeInTheDocument();
  });
  it("marking one as called takes it off the list; a failure says so and keeps it", async () => {
    const acted = vi.fn(async (): Promise<Done<true>> => ({ ok: true, value: true }));
    render(<HotLeads words={words} items={[hot]} acted={acted} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "I have called them" })));
    expect(acted).toHaveBeenCalledWith("a1");
    await waitFor(() => expect(screen.queryByText("Ravi K.")).toBeNull());
    cleanup();
    render(<HotLeads words={words} items={[hot]} acted={vi.fn(async (): Promise<Done<true>> => ({ ok: false, error: "down" }))} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "I have called them" })));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Ravi K.")).toBeInTheDocument();
  });
});
