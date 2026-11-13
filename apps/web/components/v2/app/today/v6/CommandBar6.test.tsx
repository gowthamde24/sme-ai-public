import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await import("../ask/AskSessionHost");
  await import("../ask/AskDoIt");
  await import("./LiveBar");
});
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/22222222-2222-2222-2222-222222222222", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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
import { parseTask } from "@/lib/api/tasks";

import type { TaskActions } from "../../tasks/task-actions";
import { AskProvider } from "../ask/AskProvider";
import { ASK_WORD_KEYS } from "../ask/ask-words";
import type { AskEvent, AskTransport } from "../ask/ask-types";
import type { DoItOptions } from "../ask/use-do-it";
import { PLACEHOLDER_KEYS } from "./band-data";
import { CommandBar6 } from "./CommandBar6";
import { setTalking } from "./v6-state";

vi.setConfig({ testTimeout: 15000 });

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const dict = appDict("en") as Record<string, string>;
const en = appT("en");
const ASK = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const DO_WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.")));
const ID = "33333333-3333-4333-8333-333333333333";
const CID = "44444444-4444-4444-8444-444444444444";
const PLAN = { channel: "call", goal: "Ask each customer about wedding sarees.", questions: [], script_notes: "", message_text: null, window: { date: "2026-11-13", from_minute: 600, to_minute: 1020 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 14, contacts_sample: [{ contact_id: CID, name: "Ravi Kumar" }], unmatched: [], notes: [] };
const task = () =>
  parseTask({ id: ID, status: "planned", instruction: "Call people", language: "en", template: "offer_invite", question: null, plan: PLAN, estimate: { contacts: 14, calls: 14, messages: 0, minutes: 28, cost_paise: 12600, basis: "fake rates" }, cap_paise: 15000, spent_paise: 0, pause_reason: null, progress: { total: 14, excluded: 0, waiting: 14, in_progress: 0, done: 0, failed: 0, skipped: 0, reached: 0, positive: 0 }, plan_sha256: "ab".repeat(32), simulated: true, wording: "draft", created_at: "2026-11-13T05:00:00Z", approved_at: null, finished_at: null });
const actions = (): TaskActions => {
  const ok = Promise.resolve({ ok: true as const, task: task() });
  const never = () => ok;
  return { plan: vi.fn(() => ok), answer: vi.fn(never), exclude: vi.fn(never), approve: vi.fn(never), setCap: vi.fn(never), run: vi.fn(never), pause: vi.fn(never), resume: vi.fn(never), cancel: vi.fn(never), progress: vi.fn(never), report: vi.fn(() => Promise.reject(new Error("no"))), templates: vi.fn(() => Promise.resolve({ ok: true as const, templates: [] })) } as unknown as TaskActions;
};
const asked: string[] = [];
const transport: AskTransport = async function* (req) {
  asked.push(req.question);
  const events: AskEvent[] = [{ type: "text", delta: "An ordinary answer." }, { type: "done" }];
  for (const e of events) yield e;
};
const doIt = (a: TaskActions): DoItOptions => ({ actions: a, powers: { plan: true, approve: true, move: true }, words: DO_WORDS });
const bar = (opts: { doIt?: DoItOptions | null; job?: { n: number; text: string } | null; availability?: "live" | "not_available" | "switched_off" } = {}) => (
  <AskProvider lang="en" base={BASE} words={ASK} chipWords={ASK} availability={opts.availability ?? "live"} transport={transport} voiceStatus={null} doIt={opts.doIt ?? null}>
    <CommandBar6 lang="en" base={BASE} availability={opts.availability ?? "live"} words={WORDS} askWords={ASK} chips={["What needs me today?"]} job={opts.job ?? null} />
  </AskProvider>
);

beforeEach(() => {
  asked.length = 0;
  setTalking(false);
  window.localStorage.clear();
  // a desktop (min-width: 768px) that does not ask for reduced motion
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  setTalking(false);
  vi.useRealTimers();
});

const input = () => document.getElementById("ask-input") as HTMLInputElement;
const ready = async () => {
  await waitFor(() => expect(input()).not.toBeDisabled());
};

describe("Today's command bar (design system v6)", () => {
  it("is the glowing bar with the real orb and its 'Talk live' badge, the label, and a 24 px input", async () => {
    render(bar());
    await ready();
    const section = document.querySelector('[data-part="command-bar"]') as HTMLElement;
    expect(section).toHaveClass("ds-glow");
    expect(within(section).getByText("TELL YOUR ASSISTANT WHAT TO DO")).toBeInTheDocument();
    expect(section.querySelector("[data-orb]")).not.toBeNull(); // the real orb, not a drawing of ours
    expect(document.querySelector('[data-part="talk-badge"]')).toHaveTextContent("▶Talk live");
    expect(input()).toHaveClass("text-2xl");
  });

  it("row 2 has the four chips, a language dropdown and 'Do it →' (disabled while the input is empty)", async () => {
    render(bar());
    await ready();
    const row2 = document.querySelector('[data-part="band-row2"]') as HTMLElement;
    expect(within(row2).getAllByRole("button").map((b) => b.textContent).filter((x) => x && x !== "Do it →")).toEqual(["Call people", "WhatsApp", "Quote", "Find customers"]);
    expect(within(row2).getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(within(row2).getByRole("button", { name: "Do it →" })).toBeDisabled();
  });

  it("cycles real examples as the placeholder, stops while the person types, and keeps the first with reduced motion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(bar());
    expect(input().placeholder).toBe(en(PLACEHOLDER_KEYS[0] as "frame.notyet"));
    act(() => void vi.advanceTimersByTime(4600));
    expect(input().placeholder).toBe(dict[PLACEHOLDER_KEYS[1]]);
    act(() => void vi.advanceTimersByTime(4600));
    expect(input().placeholder).toBe(dict[PLACEHOLDER_KEYS[2]]);
    fireEvent.focus(input());
    act(() => void vi.advanceTimersByTime(20_000));
    expect(input().placeholder).toBe(dict[PLACEHOLDER_KEYS[2]]);
    cleanup();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(bar());
    act(() => void vi.advanceTimersByTime(20_000));
    expect(input().placeholder).toBe(dict[PLACEHOLDER_KEYS[0]]);
  });

  it("a chip prefills the input (and focuses it) without sending anything", async () => {
    render(bar());
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(input().value).toBe(dict["tv6.chip.quote.fill"]);
    expect(document.activeElement).toBe(input());
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Find customers" }));
    expect(input().value).toBe(dict["tv6.chip.find.fill"]);
  });

  it("'Do it →' goes into the EXISTING plan-card flow: a plan card with Approve, the instruction is planned, not asked", async () => {
    const a = actions();
    render(bar({ doIt: doIt(a) }));
    await ready();
    fireEvent.change(input(), { target: { value: "Call people who asked about wedding sarees" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Do it →" })));
    const card = await waitFor(() => {
      const c = document.querySelector("[data-part=plan-card]");
      expect(c).not.toBeNull();
      return c as HTMLElement;
    });
    expect(a.plan).toHaveBeenCalledTimes(1);
    expect((a.plan as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Call people who asked about wedding sarees");
    expect(asked).toEqual([]);
    expect(within(card).getByRole("button", { name: "Approve all (14)" })).toBeInTheDocument(); // nothing runs before the OK
    await waitFor(() => expect(input().value).toBe(""));
  });

  it("Enter sends too (the form submits); where there is no plan mode the instruction is asked as a question", async () => {
    render(bar({ doIt: null }));
    await ready();
    fireEvent.change(input(), { target: { value: "What needs me today?" } });
    await act(async () => void fireEvent.submit(input().closest("form") as HTMLFormElement));
    await waitFor(() => expect(asked).toEqual(["What needs me today?"]));
    expect(await screen.findByText("An ordinary answer.")).toBeInTheDocument();
  });

  it("a suggested job (a new press) goes in at once", async () => {
    const a = actions();
    const { rerender } = render(bar({ doIt: doIt(a), job: null }));
    await ready();
    rerender(bar({ doIt: doIt(a), job: { n: 1, text: "Call my 5 new enquiries" } }));
    await waitFor(() => expect(a.plan).toHaveBeenCalledTimes(1));
    expect((a.plan as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Call my 5 new enquiries");
    rerender(bar({ doIt: doIt(a), job: { n: 1, text: "Call my 5 new enquiries" } }));
    expect(a.plan).toHaveBeenCalledTimes(1); // the same press is not sent twice
  });

  it("tapping the orb turns the SAME bar into the live conversation in place; End returns to the input, Type too", async () => {
    render(bar());
    await ready();
    const section = document.querySelector('[data-part="command-bar"]');
    fireEvent.click(screen.getByRole("button", { name: "Talk live" }));
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    expect(document.querySelector('[data-part="command-bar"]')).toBe(section); // the same bar, no popup, no dialog
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(input()).toBeNull();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(input()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Talk live" }));
    fireEvent.click(await screen.findByRole("button", { name: "Type" }));
    await waitFor(() => expect(input()).not.toBeNull());
  });

  it("where the assistant is not on, the card's own old states are drawn (no new input)", () => {
    render(bar({ availability: "not_available" }));
    expect(document.getElementById("ask-input")).toBeNull();
    expect(document.querySelector('[data-v6]')).toBeNull();
  });
});
