import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { parseReport, parseTask, parseTemplates } from "@/lib/api/tasks";

import type { TaskActions, TaskPowers } from "./task-actions";
import { TaskComposer } from "./TaskComposer";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import { TaskLive } from "./TaskLive";
import { TaskReport } from "./TaskReport";
import { noteText } from "./task-format";
import { makeT } from "../words";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.") || k.startsWith("asst.lang.")));
const ID = "33333333-3333-4333-8333-333333333333";
const CID = "44444444-4444-4444-8444-444444444444";
const CID2 = "55555555-5555-4555-8555-555555555555";
const BASE = "/app/tenants/22222222-2222-4222-8222-222222222222";
const OWNER: TaskPowers = { plan: true, approve: true, move: true };
const ADMIN: TaskPowers = { plan: true, approve: false, move: true };
const READER: TaskPowers = { plan: false, approve: false, move: false };

const PLAN = { channel: "call", goal: "Ask each supplier today's price.", questions: [{ key: "price_per_bag", text: "Price per bag?", type: "amount" }], script_notes: "", message_text: "Hello, what is your price?", window: { date: "2026-10-28", from_minute: 600, to_minute: 1140 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 12, contacts_sample: [{ contact_id: CID, name: "Sri Venkateswara Traders" }, { contact_id: CID2, name: "Lakshmi Cement Depot" }], unmatched: [{ name: null, phone_last4: "3210" }], notes: ["Promotional calls are off: WhatsApp only."] };
const progressAt = (done: number, extra: Record<string, number> = {}) => ({ total: 12, excluded: 0, waiting: 12 - done, in_progress: done < 12 ? 1 : 0, done, failed: 0, skipped: 0, reached: done, positive: Math.floor(done / 2), ...extra });
const task = (over: Record<string, unknown> = {}) =>
  parseTask({ id: ID, status: "planned", instruction: "Call my cement suppliers", language: "te", template: "supplier_price_enquiry", question: null, plan: PLAN, estimate: { contacts: 12, calls: 12, messages: 0, minutes: 24, cost_paise: 3000, basis: "fake rates" }, cap_paise: 3600, spent_paise: 0, pause_reason: null, progress: progressAt(0), plan_sha256: "ab".repeat(32), simulated: true, wording: "draft", created_at: "2026-10-28T05:00:00Z", approved_at: null, finished_at: null, ...over });
const ok = (t: ReturnType<typeof task>) => Promise.resolve({ ok: true as const, task: t });
function actions(over: Partial<TaskActions> = {}): TaskActions {
  return {
    plan: vi.fn(() => ok(task({ id: "66666666-6666-4666-8666-666666666666" }))),
    answer: vi.fn(() => ok(task())),
    exclude: vi.fn(() => ok(task({ plan_sha256: "cd".repeat(32), progress: progressAt(0, { excluded: 1, waiting: 11 }) }))),
    approve: vi.fn(() => ok(task({ status: "approved" }))),
    setCap: vi.fn(() => ok(task({ cap_paise: 9000 }))),
    run: vi.fn(() => ok(task({ status: "running" }))),
    pause: vi.fn(() => ok(task({ status: "paused", pause_reason: "owner", progress: progressAt(4) }))),
    resume: vi.fn(() => ok(task({ status: "running", progress: progressAt(4) }))),
    cancel: vi.fn(() => ok(task({ status: "cancelled" }))),
    progress: vi.fn(() => ok(task({ status: "running", progress: progressAt(3) }))),
    report: vi.fn(() => Promise.resolve({ ok: true as const, report: REPORT })),
    templates: vi.fn(() => Promise.resolve({ ok: true as const, templates: [] })),
    ...over,
  };
}
const ROW = (n: string, id: string, extra: Record<string, unknown> = {}) => ({ contact_id: id, name: n, phone_last4: "3210", outcome: "positive", category: "interested", captured: { price_per_bag: 39500, delivery_day: "Thursday" }, transcript: [{ who: "assistant", text: "Hello <b>there</b>" }, { who: "contact", text: "It is 395." }], recording_url: null, simulated: true, message_status: "queued", ...extra });
const REPORT = parseReport({ task_id: ID, status: "done", short_answer: "Cheapest: Sri Venkateswara Traders ₹395/bag, delivery Thursday", short_answer_kind: "cheapest", totals: { contacts: 12, reached: 9, positive: 4, negative: 3, unclear: 2, no_answer: 3, spent_paise: 3120 }, rows: [ROW("Sri Venkateswara Traders", CID), ROW("Lakshmi Cement Depot", CID2, { outcome: "no_answer", category: null, captured: null, transcript: null, message_status: null })] });

beforeEach(() => push.mockClear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the report", () => {
  it("puts the short answer first and big, in the task's language, then totals, then a table per person", () => {
    render(<TaskReport report={REPORT} task={task()} words={words} />);
    const section = document.querySelector("[data-part=report]") as HTMLElement;
    const answer = within(section).getByText(/Cheapest: Sri Venkateswara Traders/);
    expect(answer).toHaveAttribute("lang", "te");
    expect(answer.className).toContain("text-2xl");
    const order = [...section.querySelectorAll("[data-part]")].map((e) => e.getAttribute("data-part"));
    expect(order.indexOf("short-answer")).toBeLessThan(order.indexOf("totals"));
    expect(order.indexOf("totals")).toBeLessThan(order.indexOf("rows"));
    expect(document.querySelector("[data-part=totals]")).toHaveTextContent("People12");
    expect(document.querySelector("[data-part=totals]")).toHaveTextContent("Spent₹31.20");
    const rows = document.querySelectorAll("[data-part=rows] tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Sri Venkateswara Traders");
    expect(rows[0]).toHaveTextContent("…3210");
    expect(rows[0]).toHaveTextContent("Interested");
    expect(rows[0]).toHaveTextContent("price per bag: ₹395"); // an amount question is drawn as rupees
    expect(rows[0]).toHaveTextContent("delivery day: Thursday");
    expect(rows[0]).toHaveTextContent("Waiting to be sent");
    expect(rows[1]).toHaveTextContent("No answer");
    expect(rows[1]).toHaveTextContent("No transcript");
  });
  it("says 'simulated' by the result and by the transcript, which is closed in a details element and plain text", () => {
    render(<TaskReport report={REPORT} task={task()} words={words} />);
    expect(document.querySelector("[data-part=simulated]")).toHaveTextContent("Simulated: no real call was made.");
    const details = document.querySelector("[data-part=rows] details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Transcript (simulated)")).toBeInTheDocument();
    expect(details).toHaveTextContent("Hello <b>there</b>"); // a tag in a line is text, never markup
    expect(details.querySelector("b")).toBeNull();
  });
  it("says so when nobody was reached", () => {
    render(<TaskReport report={{ ...REPORT, rows: [] }} task={task()} words={words} />);
    expect(screen.getByText("Nobody has been reached yet.")).toBeInTheDocument();
  });
});

describe("the live progress", () => {
  it("draws a bar and 'N of M' in a polite live region, and polls every few seconds until the task is paused", async () => {
    vi.useFakeTimers();
    const progress = vi.fn().mockResolvedValueOnce({ ok: true, task: task({ status: "running", progress: progressAt(3) }) }).mockResolvedValueOnce({ ok: true, task: task({ status: "paused", pause_reason: "owner", progress: progressAt(5) }) });
    const onTask = vi.fn();
    const { rerender } = render(<TaskLive task={task({ status: "running", progress: progressAt(1) })} words={words} actions={actions({ progress })} powers={OWNER} onTask={onTask} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "12");
    expect(screen.getByText("1 of 12")).toHaveAttribute("aria-live", "polite");
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    expect(progress).toHaveBeenCalledTimes(1);
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ progress: expect.objectContaining({ done: 3 }) }));
    rerender(<TaskLive task={task({ status: "running", progress: progressAt(3) })} words={words} actions={actions({ progress })} powers={OWNER} onTask={onTask} />);
    expect(screen.getByText("3 of 12")).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    expect(progress).toHaveBeenCalledTimes(2);
    rerender(<TaskLive task={task({ status: "paused", pause_reason: "owner", progress: progressAt(5) })} words={words} actions={actions({ progress })} powers={OWNER} onTask={onTask} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(progress).toHaveBeenCalledTimes(2); // no polling while paused
    expect(screen.getByText("5 of 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
  it("does not poll a task that is not running, and stops polling when it unmounts", async () => {
    vi.useFakeTimers();
    const progress = vi.fn(() => ok(task({ status: "running" })));
    const { unmount } = render(<TaskLive task={task({ status: "done", progress: progressAt(12) })} words={words} actions={actions({ progress })} powers={OWNER} onTask={vi.fn()} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(progress).not.toHaveBeenCalled();
    unmount();
    const live = render(<TaskLive task={task({ status: "running" })} words={words} actions={actions({ progress })} powers={OWNER} onTask={vi.fn()} />);
    live.unmount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(progress).not.toHaveBeenCalled();
  });
  it("says it could not refresh when a poll fails, and tries again", async () => {
    vi.useFakeTimers();
    const progress = vi.fn().mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValue({ ok: true, task: task({ status: "running", progress: progressAt(2) }) });
    render(<TaskLive task={task({ status: "running" })} words={words} actions={actions({ progress })} powers={OWNER} onTask={vi.fn()} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    expect(screen.getByText("Could not refresh just now. Trying again.")).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    expect(screen.queryByText("Could not refresh just now. Trying again.")).toBeNull();
  });
  it("offers Continue after a long stand-still, and Pause while it runs", async () => {
    vi.useFakeTimers();
    const same = vi.fn(() => ok(task({ status: "running", progress: progressAt(2) })));
    const a = actions({ progress: same });
    render(<TaskLive task={task({ status: "running", progress: progressAt(2) })} words={words} actions={a} powers={OWNER} onTask={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "It seems stuck: continue" })).toBeNull();
    for (let i = 0; i < 8; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    const stuck = screen.getByRole("button", { name: "It seems stuck: continue" });
    await act(async () => void fireEvent.click(stuck));
    expect(a.run).toHaveBeenCalledWith(ID);
  });
  it("asks before cancelling, and cancels only after a yes", async () => {
    const a = actions();
    const onTask = vi.fn();
    render(<TaskLive task={task({ status: "running", progress: progressAt(2) })} words={words} actions={a} powers={OWNER} onTask={onTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel the task" }));
    expect(a.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "No, keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the task" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Yes, cancel it" })));
    expect(a.cancel).toHaveBeenCalledWith(ID);
    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
  it("shows no buttons to a person who cannot move a task", () => {
    render(<TaskLive task={task({ status: "running" })} words={words} actions={actions()} powers={READER} onTask={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("when paused for the cap: says what was spent, and the Owner raises the limit and continues (second factor on the server)", async () => {
    const a = actions({ resume: vi.fn(() => ok(task({ status: "running", cap_paise: 9000, progress: progressAt(5) }))) });
    const onTask = vi.fn();
    render(<TaskLive task={task({ status: "paused", pause_reason: "cap", spent_paise: 1000, cap_paise: 1000, progress: progressAt(4) })} words={words} actions={a} powers={OWNER} onTask={onTask} />);
    expect(screen.getByText(/Stopped: it has spent ₹10, the limit you set \(₹10\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull(); // the plain Continue would stop at once again
    fireEvent.change(screen.getByLabelText("New limit in rupees"), { target: { value: "90" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Raise the limit and continue" })));
    expect(a.setCap).toHaveBeenCalledWith(ID, 9000);
    expect(a.resume).toHaveBeenCalledWith(ID);
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: "running" }));
  });
  it("a limit raised without the second factor says so, with the way to set it up; an Admin is told to ask the Owner", async () => {
    const a = actions({ setCap: vi.fn(() => Promise.resolve({ ok: false as const, error: "mfa" as const })) });
    const paused = task({ status: "paused", pause_reason: "cap", spent_paise: 1000, cap_paise: 1000 });
    render(<TaskLive task={paused} words={words} actions={a} powers={OWNER} onTask={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New limit in rupees"), { target: { value: "90" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Raise the limit and continue" })));
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/app/security");
    expect(a.resume).not.toHaveBeenCalled();
    cleanup();
    render(<TaskLive task={paused} words={words} actions={a} powers={ADMIN} onTask={vi.fn()} />);
    expect(screen.getByText("Ask the Owner to raise the limit.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New limit in rupees")).toBeNull();
  });
});

describe("the task page", () => {
  const draw = (t: ReturnType<typeof task>, a = actions(), powers = OWNER, extra: Partial<Parameters<typeof TaskDetail>[0]> = {}) =>
    render(<TaskDetail initialTask={t} initialReport={null} everyone={null} words={words} lang="en" base={BASE} actions={a} powers={powers} {...extra} />);
  it("shows the plan card with one Approve all; the Owner approves with the newest hash and the card moves to the live part", async () => {
    const a = actions();
    draw(task(), a);
    expect(screen.getByRole("button", { name: "Approve all (12)" })).toBeEnabled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (12)" })));
    expect(a.approve).toHaveBeenCalledWith(ID, "ab".repeat(32), null);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
  });
  it("leaving someone out asks the server, and the approval then sends the new hash", async () => {
    const a = actions();
    draw(task(), a);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" }));
    await waitFor(() => expect(a.exclude).toHaveBeenCalledWith(ID, [CID], true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve all (11)" })).toBeInTheDocument());
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (11)" })));
    expect(a.approve).toHaveBeenCalledWith(ID, "cd".repeat(32), null);
  });
  it("puts a tick back when the server refuses the exclusion", async () => {
    const a = actions({ exclude: vi.fn(() => Promise.resolve({ ok: false as const, error: "state" as const })) });
    draw(task(), a);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("moved on"));
    expect(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" })).toBeChecked();
  });
  it("lists everyone under 'See everyone', with ticks, the WhatsApp wording and the notes in our words", () => {
    const everyone = [{ id: "a", contact_id: CID, name: "Sri Venkateswara Traders", phone_last4: "3210", status: "waiting" as const, skip_reason: null, outcome: null, outcome_category: null, captured: null, simulated: true }, { id: "b", contact_id: CID2, name: "Lakshmi Cement Depot", phone_last4: "1111", status: "excluded" as const, skip_reason: null, outcome: null, outcome_category: null, captured: null, simulated: true }];
    draw(task(), actions(), OWNER, { everyone });
    const list = document.querySelector("[data-part=everyone]") as HTMLElement;
    expect(within(list).getByText("See everyone (2)")).toBeInTheDocument();
    expect(within(list).getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve all (11)" })).toBeInTheDocument(); // one is left out already
    expect(document.querySelector("[data-part=message]")).toHaveTextContent("Hello, what is your price?");
    expect(document.querySelector("[data-part=notes]")).toHaveTextContent("Promotional calls are off: WhatsApp only. Only people who agreed to offers are included.");
    expect(document.querySelector("[data-part=notes]")).toHaveTextContent("Left out because they are not in your contacts: 1 (…3210).");
  });
  it("names why an approval did not happen, including the ones the plan card has no word for", async () => {
    const a = actions({ approve: vi.fn(() => Promise.resolve({ ok: false as const, error: "waiting_for_whatsapp" as const })) });
    draw(task(), a);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (12)" })));
    expect(screen.getAllByRole("alert").map((x) => x.textContent).join(" ")).toContain("WhatsApp is not ready");
    cleanup();
    const school = actions({ approve: vi.fn(() => Promise.resolve({ ok: false as const, error: "not_for_schools" as const })) });
    draw(task(), school);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (12)" })));
    expect(screen.getAllByRole("alert").map((x) => x.textContent).join(" ")).toContain("fees, marks or dues");
  });
  it("a stale plan is re-read so the person looks again", async () => {
    const a = actions({ approve: vi.fn(() => Promise.resolve({ ok: false as const, error: "changed" as const })) });
    draw(task(), a);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (12)" })));
    expect(a.progress).toHaveBeenCalledWith(ID);
    expect(screen.getByRole("alert")).toHaveTextContent("The plan changed");
  });
  it("only the Owner has an enabled Approve all; an Admin can leave people out", () => {
    draw(task(), actions(), ADMIN);
    expect(screen.getByRole("button", { name: "Approve all (12)" })).toBeDisabled();
    expect(screen.getByText(/Only the Owner can approve/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" })).toBeEnabled();
  });
  it("a reader sees the plan, and a tick does nothing for them", () => {
    const a = actions();
    draw(task(), a, READER);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" }));
    expect(a.exclude).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Sri Venkateswara Traders" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Plan again in this language" })).toBeNull();
  });
  it("the nobody-found case has no Approve button: say who, or give a list; a pasted list goes with the new plan", async () => {
    const a = actions();
    draw(task({ plan: { ...PLAN, contacts_total: 0, contacts_sample: [], unmatched: [], notes: ["Nobody in your contacts fits this yet. Say who, or give a list."] } }), a);
    expect(screen.getByText("Nobody found yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve all/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Or give a list (optional)"), { target: { value: "Ravi, 98765 43210\nbad line" } });
    expect(screen.getByText("Numbers read: 1. Lines skipped: 1.")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Plan again" })));
    expect(a.plan).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "Call my cement suppliers", "te", [{ name: "Ravi", phone: "98765 43210" }]);
    expect(push).toHaveBeenCalledWith(`${BASE}/tasks/66666666-6666-4666-8666-666666666666`);
  });
  it("asks the one question and takes the answer", async () => {
    const a = actions();
    draw(task({ status: "needs_answer", plan: null, estimate: null, cap_paise: null, plan_sha256: null, question: "Who should be called?" }), a);
    expect(screen.getByText("Who should be called?")).toHaveAttribute("lang", "te");
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "my suppliers" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Answer" })));
    expect(a.answer).toHaveBeenCalledWith(ID, "my suppliers");
    expect(await screen.findByRole("button", { name: "Approve all (12)" })).toBeInTheDocument();
  });
  it("offers all six call languages and makes a NEW plan when another is chosen", async () => {
    const a = actions();
    draw(task(), a);
    const select = screen.getByLabelText("Choose another language") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value).sort()).toEqual(["en", "hi", "kn", "ml", "ta", "te"]);
    expect(screen.getByRole("button", { name: "Plan again in this language" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "ta" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Plan again in this language" })));
    expect(a.plan).toHaveBeenCalledWith(expect.any(String), "Call my cement suppliers", "ta");
    expect(push).toHaveBeenCalled();
  });
  it("a finished task shows its report (read when it finished while open) and keeps the plan folded", async () => {
    const a = actions();
    draw(task({ status: "done", progress: progressAt(12), finished_at: "2026-10-28T05:03:00Z" }), a);
    expect(await screen.findByText(/Cheapest: Sri Venkateswara Traders/)).toBeInTheDocument();
    expect(a.report).toHaveBeenCalledWith(ID);
    expect((document.querySelector("[data-part=plan-folded]") as HTMLDetailsElement).open).toBe(false);
  });
  it("says so when the report cannot be read", async () => {
    draw(task({ status: "done" }), actions({ report: vi.fn(() => Promise.resolve({ ok: false as const, error: "down" as const })) }));
    expect(await screen.findByText("The report could not be loaded. Open the page again.")).toBeInTheDocument();
  });
});

describe("the Tasks page parts", () => {
  const templates = parseTemplates({ templates: [{ id: "call_new_leads", label: "Call new leads", channel_default: "call", needs_pack: null, promotional: false, example_instruction: "Call new leads now" }, { id: "offer_invite", label: "Offer or event invite", channel_default: "whatsapp", needs_pack: null, promotional: true, example_instruction: "Invite them" }] }).templates;
  it("a chip puts its example in the box for the owner to change, and the offer chip says who is included", () => {
    render(<TaskComposer words={words} base={BASE} actions={actions()} templates={templates} canPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Call new leads" }));
    expect((screen.getByLabelText("What should your assistant do?") as HTMLTextAreaElement).value).toMatch(/Call everyone who enquired this week/);
    expect(document.querySelector("[data-part=offer-note]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Offer or event invite" }));
    expect(document.querySelector("[data-part=offer-note]")).toHaveTextContent("Only people who agreed to offers are included. WhatsApp only for now.");
  });
  it("pre-fills from a link, puts the cursor in the box, and offers the six languages", () => {
    render(<TaskComposer words={words} base={BASE} actions={actions()} templates={templates} canPlan initial="Call my suppliers" focus />);
    const box = screen.getByLabelText("What should your assistant do?");
    expect(box).toHaveValue("Call my suppliers");
    expect(box).toHaveFocus();
    expect([...(screen.getByLabelText("Customers' language") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["auto", "te", "hi", "kn", "en", "ta", "ml"]);
  });
  it("makes the plan once with one id (a retry is a replay), in the chosen language, and opens it", async () => {
    const a = actions({ plan: vi.fn().mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValue({ ok: true, task: task({ id: "66666666-6666-4666-8666-666666666666" }) }) });
    render(<TaskComposer words={words} base={BASE} actions={a} templates={templates} canPlan initial="Call my suppliers" />);
    fireEvent.change(screen.getByLabelText("Customers' language"), { target: { value: "ml" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Make a plan" })));
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Make a plan" })));
    const calls = (a.plan as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[1].slice(1)).toEqual(["Call my suppliers", "ml", []]);
    expect(push).toHaveBeenCalledWith(`${BASE}/tasks/66666666-6666-4666-8666-666666666666`);
  });
  it("cannot make a plan with fewer than three letters, and a reader gets a sentence instead of the box", () => {
    render(<TaskComposer words={words} base={BASE} actions={actions()} templates={templates} canPlan initial="ab" />);
    expect(screen.getByRole("button", { name: "Make a plan" })).toBeDisabled();
    cleanup();
    render(<TaskComposer words={words} base={BASE} actions={actions()} templates={templates} canPlan={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("[data-part=viewer]")).toHaveTextContent("You can read tasks here.");
  });
  it("lists tasks with the state, N of M and a link to open; an empty list says so", () => {
    render(<TaskList tasks={[task({ status: "running", progress: progressAt(3) }), task({ id: CID, status: "done", progress: progressAt(12) })]} words={words} base={BASE} lang="en" empty="Nothing is running right now." />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Running");
    expect(items[0]).toHaveTextContent("3 of 12");
    expect(within(items[0]).getByRole("link", { name: "Open" })).toHaveAttribute("href", `${BASE}/tasks/${ID}`);
    expect(within(items[1]).getByRole("link", { name: "Open the report" })).toHaveAttribute("href", `${BASE}/tasks/${CID}`);
    cleanup();
    render(<TaskList tasks={[]} words={words} base={BASE} lang="en" empty="Nothing is running right now." />);
    expect(screen.getByText("Nothing is running right now.")).toBeInTheDocument();
  });
  it("turns the API's closed notes into our words and leaves an unknown one as it is", () => {
    const t = makeT(words);
    expect(noteText("Nobody in your contacts fits this yet...", t)).toBe("Nobody in your contacts fits this yet. Say who, or give a list.");
    expect(noteText("capped at 500", t)).toBe("The list was cut to the first 500 people.");
    expect(noteText("something new", t)).toBe("something new");
  });
});
