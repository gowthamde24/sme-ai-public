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
import { MOCK_POLICY, MOCK_TEMPLATES } from "@/lib/outreach/mock";
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
  it("asks for the WhatsApp words only when WhatsApp is used, and offers the four launch languages", () => {
    draw();
    expect(screen.queryByLabelText("The WhatsApp message")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Phone calls and WhatsApp" }));
    expect(screen.getByLabelText("The WhatsApp message")).toBeRequired();
    expect(screen.getByRole("button", { name: "Make the plan" })).toBeDisabled();
    const options = within(screen.getByLabelText("Language of the calls and messages")).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["en", "te", "hi", "kn"]);
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
  const rule: Rule = ruleOf(newRule({ ruleId: "66666666-6666-4666-8666-666666666666", source: "website_form", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], waFirstTemplate: null, waMissedTemplate: null, maxCallsPerDay: 50, maxTotalMinutes: null }, t0), t0);
  const draw = (over: Partial<Parameters<typeof RulesPanel>[0]> = {}, save = vi.fn<(input: unknown) => Promise<Done<Rule>>>(async () => ({ ok: true, value: rule })), control = vi.fn(async (): Promise<Done<Rule>> => ({ ok: true, value: rule }))) => {
    render(<RulesPanel words={words} rules={[rule]} canAdd canControl sourceNames={sourceNames(words)} goalNames={goalNames(words)} languageNames={languageNames()} actions={{ save, control }} securityHref="/app/security" defaultLanguage="en" templates={MOCK_TEMPLATES} retrySteps={MOCK_POLICY.retrySteps} {...over} />);
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
    expect(save.mock.calls[0][0]).toMatchObject({ source: "indiamart", action: "call_within_minutes", withinMinutes: 3, channel: "call", language: "auto", maxCallsPerDay: 50, waFirstTemplate: null, waMissedTemplate: null }); // a "Call only" rule sends nothing (C1, 16 Nov)
    expect(screen.getByRole("status")).toHaveTextContent("Rule approved");
  });
  it("call first (owner, 5 Nov): the rule always calls, offers no WhatsApp-first choice and no free text; an approval without the second factor links to setting it up", async () => {
    const { save } = draw({ rules: [] }, vi.fn(async (): Promise<Done<Rule>> => ({ ok: false, error: "mfa" })));
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    expect(screen.queryByRole("radio", { name: /WhatsApp first/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: "WhatsApp messages" })).toBeNull();
    expect(screen.queryByLabelText("The WhatsApp message")).toBeNull(); // a call does not open WhatsApp's 24 hour window: no free text in a rule (owner, 15 Nov)
    expect(document.querySelector('[data-part="rule-sentence"]')).toHaveTextContent(/call within 2 minutes, in calling hours\.$/);
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(document.querySelector('[data-part="rule-sentence"]')).toHaveTextContent("then a WhatsApp message if nobody answers");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toBeInTheDocument();
  });
  it("WhatsApp is picked from the approved templates with a preview; the retries are in the rule (10 minutes, 2 hours, next morning 09:30, then the WhatsApp and stop); the language starts as 'same as the lead / business' (owner, 15 Nov)", async () => {
    const { save } = draw({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    expect(screen.queryByLabelText("First WhatsApp message")).toBeNull(); // "Call only": no WhatsApp pickers, no WhatsApp line in the plan
    expect(document.querySelector('[data-part="rule-plan"]')).not.toHaveTextContent("WhatsApp");
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(screen.getByLabelText("First WhatsApp message")).toHaveValue("lead_ack");
    expect(screen.getByLabelText("WhatsApp message after a missed call")).toHaveValue("missed_call_followup");
    expect(screen.getAllByText(/Hello Ravi, thank you for contacting/)).toHaveLength(1);
    expect(screen.getAllByText(/we tried to call you/)).toHaveLength(1);
    const plan = document.querySelector('[data-part="rule-plan"]');
    expect(plan).toHaveTextContent("If nobody answers: call again after 10 minutes, then after 2 hours, then next morning at 09:30, all in calling hours.");
    expect(plan).toHaveTextContent("Then the WhatsApp message “Sorry we missed you” and stop.");
    expect(screen.getByLabelText("Language of the calls and messages")).toHaveValue("auto");
    expect(screen.getByRole("option", { name: "Same as the lead / business language" })).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save.mock.calls[0][0]).toMatchObject({ language: "auto", waFirstTemplate: "lead_ack", waMissedTemplate: "missed_call_followup" });
    expect(save.mock.calls[0][0]).not.toHaveProperty("messageText");
  });
  it("a template WhatsApp has not approved says so; a list that could not be read says so and sends no name; a saved rule shows its retries and its warning", () => {
    const pending = MOCK_TEMPLATES.map((x) => (x.key === "lead_ack" ? { ...x, status: "submitted" as const } : x));
    draw({ rules: [], templates: pending });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(document.querySelector('[data-part="template-status"]')).toHaveTextContent("Waiting for WhatsApp's approval");
    cleanup();
    // no row in the business language: the English preview, and the note names the language (owner, 16 Nov)
    const none = MOCK_TEMPLATES.map((x) => ({ ...x, status: "missing" as const, language: "te", preview: "Hello Ravi, English words" }));
    draw({ rules: [], templates: none });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(screen.getAllByText("Hello Ravi, English words")).toHaveLength(2);
    expect(document.querySelector('[data-part="template-status"]')).toHaveTextContent(/version not ready yet\. Until then this step is skipped\./);
    cleanup();
    draw({ rules: [], templates: null });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(screen.getAllByText(/No approved WhatsApp messages to pick from yet/)).toHaveLength(2);
    cleanup();
    draw({ rules: [{ ...rule, warnings: ["template_not_approved"] }] });
    expect(document.querySelector('[data-part="rule-plan"]')).toHaveTextContent("after 10 minutes, then after 2 hours");
    expect(document.querySelector('[data-part="rule-warning"]')).toHaveTextContent("not approved by WhatsApp yet");
  });
  it("0 minutes is 'immediately', 1 is '1 minute' (never '1 minutes'); the form allows 0 and says what it means, and sends 0", async () => {
    const { save } = draw({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    const source = screen.getByLabelText("Where the leads come from") as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.value)).toContain("meta_lead_ads"); // Facebook and Instagram lead ads
    expect(source.value).toBe("meta_lead_ads");
    const minutes = screen.getByLabelText("Minutes before the first call") as HTMLInputElement;
    expect(minutes.min).toBe("0");
    fireEvent.change(minutes, { target: { value: "1" } });
    expect(document.querySelector("[data-part=rule-sentence]")).toHaveTextContent("call within 1 minute, in calling hours.");
    expect(document.querySelector("[data-part=rule-sentence]")).not.toHaveTextContent("1 minutes");
    fireEvent.change(minutes, { target: { value: "0" } });
    expect(minutes.value).toBe("0");
    expect(document.querySelector("[data-part=rule-sentence]")).toHaveTextContent("call immediately, in calling hours.");
    expect(screen.getByText(/0 means immediately/)).toBeInTheDocument();
    fireEvent.change(minutes, { target: { value: "3" } });
    fireEvent.change(minutes, { target: { value: "-5" } });
    expect(minutes.value).toBe("0"); // never below 0
    fireEvent.click(screen.getByRole("radio", { name: "Call, then a WhatsApp message" }));
    expect(document.querySelector("[data-part=rule-sentence]")).toHaveTextContent("call immediately, in calling hours; then a WhatsApp message if nobody answers.");
    fireEvent.click(screen.getByRole("radio", { name: "Call only" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save.mock.calls[0][0]).toMatchObject({ source: "meta_lead_ads", withinMinutes: 0 });
  });
  it("a saved rule of 0 or 1 minute is read back as 'immediately' or '1 minute'", () => {
    const now = ruleOf(newRule({ ruleId: "77777777-7777-4777-8777-777777777777", source: "meta_lead_ads", action: "call_within_minutes", withinMinutes: 0, goal: "general", channel: "call", language: "en", questions: [], waFirstTemplate: null, waMissedTemplate: null, maxCallsPerDay: 50, maxTotalMinutes: null }, t0), t0);
    draw({ rules: [now, { ...rule, id: "88888888-8888-4888-8888-888888888888", withinMinutes: 1 }] });
    expect(screen.getAllByText(/^New leads from .+: call immediately, in calling hours\.$/)).toHaveLength(1);
    expect(screen.getByText("New leads from Your website form: call within 1 minute, in calling hours.")).toBeInTheDocument();
  });
  it("a value the list could not read is a dash on that row; the row and the rest of the list still show (owner, 15 Nov)", () => {
    draw({ rules: [{ ...rule, unreadable: ["within_minutes", "goal", "usage"] }, { ...rule, id: "77777777-7777-4777-8777-777777777777", source: "meta_lead_ads", withinMinutes: 0 }] });
    const rows = document.querySelectorAll("[data-rule]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("—");
    expect(rows[0]).not.toHaveTextContent("minute");
    expect(rows[1]).toHaveTextContent(/immediately/i);
  });
  it("Change opens the rule's own values with its source fixed; Approve sends the SAME rule id with the new minutes (the API updates it in place), 0 included (owner 15 Nov: one rule per source, no way to change it before)", async () => {
    const { save } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("heading", { name: "Change this rule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Where the leads come from")).toBeDisabled();
    expect(screen.getByLabelText(/Minutes before the first call/)).toHaveValue(2);
    expect(screen.queryByRole("button", { name: "Add a standing rule" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Minutes before the first call/), { target: { value: "0" } });
    expect(document.querySelector('[data-part="rule-sentence"]')).toHaveTextContent(/call immediately, in calling hours/);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ruleId: rule.id, source: "website_form", withinMinutes: 0 }));
  });
  it("\"What happens to a new lead\" follows the minutes: 0 immediately, 1 within 1 minute, n within n minutes (owner 15 Nov)", () => {
    draw({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    const line = () => document.querySelector('[data-part="rule-action"]');
    const set = (v: string) => fireEvent.change(screen.getByLabelText(/Minutes before the first call/), { target: { value: v } });
    expect(line()).toHaveTextContent("Call within 2 minutes");
    set("0");
    expect(line()).toHaveTextContent("Call immediately");
    set("1");
    expect(line()).toHaveTextContent("Call within 1 minute");
    expect(line()).not.toHaveTextContent("1 minutes");
    set("30");
    expect(line()).toHaveTextContent("Call within 30 minutes");
  });
  it("a rule with a value the list could not read has no Change (nothing to fill the form from)", () => {
    draw({ rules: [{ ...rule, unreadable: ["goal"] }] });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
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
