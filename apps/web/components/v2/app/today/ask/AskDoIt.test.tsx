import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await import("./AskPanel");
  await import("./AskSessionHost");
  await import("./AskDoIt");
});
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/leads" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    let part: React.ComponentType<Record<string, unknown>> | null = null;
    void load().then((m) => {
      const mod = m as { default?: React.ComponentType<Record<string, unknown>> } & React.ComponentType<Record<string, unknown>>;
      part = mod.default ?? mod;
    });
    return function Lazy(props: Record<string, unknown>) {
      const Part = part;
      return Part ? <Part {...props} /> : null;
    };
  },
}));

import { appDict, appT } from "@/i18n/app";
import { parseReport, parseTask } from "@/lib/api/tasks";

vi.setConfig({ testTimeout: 15000 });

import { AskCard } from "./AskCard";
import { AskProvider } from "./AskProvider";
import { ASK_WORD_KEYS } from "./ask-words";
import type { AskEvent, AskTransport } from "./ask-types";
import type { DoItOptions } from "./use-do-it";
import type { TaskActions } from "../../tasks/task-actions";

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const en = appT("en");
const WORDS = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const CHIP_WORDS = Object.fromEntries(["ask.chip.needs", "ask.chip.call", "ask.chip.money", "ask.chip.quotes", "ask.chip.team"].map((k) => [k, en(k as "frame.notyet")]));
const DO_WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.")));
const ID = "33333333-3333-4333-8333-333333333333";
const CID = "44444444-4444-4444-8444-444444444444";

const PLAN = { channel: "call", goal: "Ask each supplier today's price.", questions: [{ key: "price_per_bag", text: "Price per bag?", type: "amount" }], script_notes: "", message_text: null, window: { date: "2026-10-28", from_minute: 600, to_minute: 1140 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 12, contacts_sample: [{ contact_id: CID, name: "Sri Venkateswara Traders" }], unmatched: [], notes: [] };
const task = (over: Record<string, unknown> = {}) =>
  parseTask({ id: ID, status: "planned", instruction: "Call my cement suppliers", language: "en", template: "supplier_price_enquiry", question: null, plan: PLAN, estimate: { contacts: 12, calls: 12, messages: 0, minutes: 24, cost_paise: 3000, basis: "fake rates" }, cap_paise: 3600, spent_paise: 0, pause_reason: null, progress: { total: 12, excluded: 0, waiting: 12, in_progress: 0, done: 0, failed: 0, skipped: 0, reached: 0, positive: 0 }, plan_sha256: "ab".repeat(32), simulated: true, wording: "draft", created_at: "2026-10-28T05:00:00Z", approved_at: null, finished_at: null, ...over });
const progressAt = (done: number) => ({ total: 12, excluded: 0, waiting: 12 - done, in_progress: done < 12 ? 1 : 0, done, failed: 0, skipped: 0, reached: done, positive: Math.floor(done / 2) });
const REPORT = parseReport({ task_id: ID, status: "done", short_answer: "Cheapest: Sri Venkateswara Traders ₹395/bag, delivery Thursday", short_answer_kind: "cheapest", totals: { contacts: 12, reached: 9, positive: 4, negative: 3, unclear: 2, no_answer: 3, spent_paise: 3000 }, rows: [] });

function fakeActions(over: Partial<TaskActions> = {}): TaskActions {
  const ok = (t: ReturnType<typeof task>) => Promise.resolve({ ok: true as const, task: t });
  return {
    plan: vi.fn(() => ok(task())),
    answer: vi.fn(() => ok(task())),
    exclude: vi.fn(() => ok(task({ plan_sha256: "cd".repeat(32) }))),
    approve: vi.fn(() => ok(task({ status: "approved", approved_at: "2026-10-28T05:01:00Z" }))),
    setCap: vi.fn(() => ok(task())),
    run: vi.fn(() => ok(task())),
    pause: vi.fn(() => ok(task({ status: "paused", pause_reason: "owner", progress: progressAt(3) }))),
    resume: vi.fn(() => ok(task())),
    cancel: vi.fn(() => ok(task({ status: "cancelled" }))),
    progress: vi.fn(() => ok(task({ status: "running", progress: progressAt(3) }))),
    report: vi.fn(() => Promise.resolve({ ok: true as const, report: REPORT })),
    templates: vi.fn(() => Promise.resolve({ ok: true as const, templates: [{ id: "supplier_price_enquiry", label: "Supplier price enquiry", example: "Call my cement suppliers", promotional: false }, { id: "offer_invite", label: "Offer or event invite", example: "Invite them", promotional: true }] })),
    ...over,
  };
}
const asked: string[] = [];
const transport: AskTransport = async function* (req) {
  asked.push(req.question);
  const events: AskEvent[] = [{ type: "text", delta: "An ordinary answer." }, { type: "done" }];
  for (const e of events) yield e;
};
const harness = (doIt: DoItOptions | null) => (
  <AskProvider lang="en" base={BASE} words={WORDS} chipWords={CHIP_WORDS} availability="live" transport={transport} voiceStatus={null} doIt={doIt}>
    {nav.pathname === BASE ? <AskCard lang="en" base={BASE} availability="live" words={WORDS} chips={["What needs me today?"]} onMood={() => undefined} /> : null}
  </AskProvider>
);
const options = (actions: TaskActions, role: "owner" | "admin" = "owner"): DoItOptions => ({ actions, powers: { plan: true, approve: role === "owner", move: true }, words: DO_WORDS });

beforeEach(() => {
  nav.pathname = BASE;
  asked.length = 0;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const doMode = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Do it" }));
  await screen.findByRole("button", { name: "Supplier price enquiry" });
};
const send = async (text: string) => {
  fireEvent.change(document.getElementById("ask-input") as HTMLInputElement, { target: { value: text } });
  await act(async () => void fireEvent.submit(document.querySelector("[data-ask-form]") as HTMLFormElement));
};

describe("'Do it' in the Ask box (night 4, tasks)", () => {
  it("has no switch when the tasks are off for this person, and the question chips stay", async () => {
    render(harness(null));
    await screen.findByPlaceholderText(/Ask|What/i).catch(() => undefined);
    await waitFor(() => expect(document.querySelector("[data-ask=live]")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull();
    expect(screen.getByRole("button", { name: "What needs me today?" })).toBeInTheDocument();
  });
  it("shows an Ask | Do it switch; Do it swaps the question chips for the task chips, and a chip fills the line", async () => {
    const actions = fakeActions();
    render(harness(options(actions)));
    expect(await screen.findByRole("button", { name: "Ask", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What needs me today?" })).toBeInTheDocument();
    await doMode();
    expect(screen.queryByRole("button", { name: "What needs me today?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Do it", pressed: true })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tell Vijaya what to do")).toBeInTheDocument();
    expect(actions.templates).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Supplier price enquiry" }));
    expect((document.getElementById("ask-input") as HTMLInputElement).value).toMatch(/cement suppliers/);
    fireEvent.click(screen.getByRole("button", { name: "Ask", pressed: false }));
    expect(screen.getByRole("button", { name: "What needs me today?" })).toBeInTheDocument();
  });
  it("sends a typed instruction to the plan action (not to the question line) and draws a plan card with ONE Approve all", async () => {
    const actions = fakeActions();
    render(harness(options(actions)));
    await doMode();
    await send("Call my cement suppliers and ask the price");
    const card = await waitFor(() => {
      const c = document.querySelector("[data-part=plan-card]");
      expect(c).not.toBeNull();
      return c as HTMLElement;
    });
    expect(actions.plan).toHaveBeenCalledTimes(1);
    const [id, instruction, language] = (actions.plan as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([instruction, language]).toEqual(["Call my cement suppliers and ask the price", null]);
    expect(asked).toEqual([]);
    expect(within(card).getByRole("button", { name: "Approve all (12)" })).toBeInTheDocument();
    expect(card.textContent).toContain("simulated");
  });
  it("polls while it runs ('3 of 12'), then reads the report when it is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const states = [task({ status: "running", progress: progressAt(3) }), task({ status: "done", progress: progressAt(12), approved_at: "2026-10-28T05:01:00Z", finished_at: "2026-10-28T05:02:00Z" })];
    const actions = fakeActions({ progress: vi.fn(() => Promise.resolve({ ok: true as const, task: states.shift() ?? states[0] })) });
    render(harness(options(actions)));
    await doMode();
    await send("Call my cement suppliers and ask the price");
    fireEvent.click(await screen.findByRole("button", { name: "Approve all (12)" }));
    await screen.findByRole("progressbar");
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    await waitFor(() => expect(screen.getByText("3 of 12")).toBeInTheDocument());
    expect(document.querySelector("[aria-live=polite]")).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2600)));
    await waitFor(() => expect(screen.getByText(/Cheapest: Sri Venkateswara Traders/)).toBeInTheDocument());
    const link = screen.getByRole("link", { name: "Open the full report" });
    expect(link).toHaveAttribute("href", `${BASE}/tasks/${ID}`);
    expect(actions.report).toHaveBeenCalledWith(ID);
  });
  it("asks the ONE question and plans again from the answer", async () => {
    const actions = fakeActions({ plan: vi.fn(() => Promise.resolve({ ok: true as const, task: task({ status: "needs_answer", plan: null, estimate: null, cap_paise: null, plan_sha256: null, question: "Who should Vijaya contact?" }) })) });
    render(harness(options(actions)));
    await doMode();
    await send("do something nice");
    expect(await screen.findByText("Who should Vijaya contact?")).toBeInTheDocument();
    fireEvent.change(document.querySelector("[data-task-state=needs_answer] input") as HTMLInputElement, { target: { value: "my suppliers" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Answer" })));
    expect(actions.answer).toHaveBeenCalledWith(ID, "my suppliers");
    await waitFor(() => expect(document.querySelector("[data-part=plan-card]")).not.toBeNull());
  });
  it("says 'nobody found' without an approve button, and says why a plan failed", async () => {
    const none = task({ plan: { ...PLAN, contacts_total: 0, contacts_sample: [], notes: ["Nobody in your contacts fits this yet."] } });
    const actions = fakeActions({ plan: vi.fn(() => Promise.resolve({ ok: true as const, task: none })) });
    render(harness(options(actions)));
    await doMode();
    await send("call people");
    expect(await screen.findByText("Nobody found yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve all/ })).toBeNull();
    cleanup();
    const failing = fakeActions({ plan: vi.fn(() => Promise.resolve({ ok: false as const, error: "not_for_schools" as const })) });
    render(harness(options(failing)));
    await doMode();
    await send("collect the fees");
    expect(await screen.findByText(/cannot mention fees, marks or dues/)).toBeInTheDocument();
  });
  it("keeps the task in the thread when the Today card gives way to the floating panel", async () => {
    const actions = fakeActions();
    const { rerender } = render(harness(options(actions)));
    await doMode();
    await send("Call my cement suppliers and ask the price");
    await screen.findByRole("button", { name: "Approve all (12)" });
    nav.pathname = `${BASE}/leads`;
    rerender(harness(options(actions)));
    fireEvent.click(await screen.findByRole("button", { name: /^Ask Vijaya/ }));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByRole("button", { name: "Approve all (12)" })).toBeInTheDocument();
    expect(actions.plan).toHaveBeenCalledTimes(1);
  });
  it("a spoken instruction in Do it mode is heard, then planned; the answer of the question line is dropped", async () => {
    const actions = fakeActions();
    const seen: string[] = [];
    const voice = async function* (): AsyncGenerator<AskEvent> {
      yield { type: "heard", text: "Call my cement suppliers" };
      seen.push("heard");
      await Promise.resolve();
      yield { type: "text", delta: "should never be shown" };
      yield { type: "done" };
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }, configurable: true });
    render(
      <AskProvider lang="en" base={BASE} words={WORDS} chipWords={CHIP_WORDS} availability="live" transport={transport} voiceStatus={{ available: true, speech: false }} voiceTransport={voice} doIt={options(actions)}>
        <AskCard lang="en" base={BASE} availability="live" words={WORDS} chips={[]} onMood={() => undefined} />
      </AskProvider>,
    );
    await doMode();
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Speak your question" })));
    await screen.findByText("Recording…");
    await act(async () => void vi.advanceTimersByTime(1500));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop and ask" })));
    await waitFor(() => expect(actions.plan).toHaveBeenCalledTimes(1));
    expect((actions.plan as ReturnType<typeof vi.fn>).mock.calls[0].slice(1)).toEqual(["Call my cement suppliers", null]);
    await waitFor(() => expect(document.querySelector("[data-part=plan-card]")).not.toBeNull());
    expect(screen.queryByText("should never be shown")).toBeNull();
    vi.unstubAllGlobals();
  });
});

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice-bytes"], { type: this.mimeType }) });
    this.onstop?.(new Event("stop"));
  }
}
