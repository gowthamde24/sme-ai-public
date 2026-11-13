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
const bar = (opts: { doIt?: DoItOptions | null; availability?: "live" | "not_available" | "switched_off"; businessLang?: string | null } = {}) => (
  <AskProvider lang="en" base={BASE} words={ASK} chipWords={ASK} availability={opts.availability ?? "live"} transport={transport} voiceStatus={null} doIt={opts.doIt ?? null}>
    <CommandBar6 lang="en" base={BASE} availability={opts.availability ?? "live"} words={WORDS} askWords={ASK} chips={["What needs me today?"]} businessLang={opts.businessLang ?? null} />
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
const ghost = () => document.querySelector('[data-part="ghost"] .ds-ghost')?.textContent ?? "";
const ready = async () => {
  await waitFor(() => expect(input()).not.toBeDisabled());
};

describe("Today's composer (the final design)", () => {
  it("is a glowing conic edge around a glass box, with a 22px one-line field and the attach icon inside it on the right", async () => {
    render(bar());
    await ready();
    const section = document.querySelector('[data-part="command-bar"]') as HTMLElement;
    expect(section).toHaveClass("ds-comp");
    expect(section.querySelector(".ds-compin")).not.toBeNull();
    expect(input().tagName).toBe("INPUT");
    expect(input()).toHaveClass("ds-ln", "border-0", "bg-transparent");
    expect(screen.getByRole("link", { name: "Attach a price list or photo" })).toHaveAttribute("href", `${BASE}/catalogue`);
    expect(section.querySelector("[data-orb]")).toBeNull(); // the orb is the band's, beside the composer
  });

  it("row 2 has THREE chips (Call people, WhatsApp, Quote), the language dropdown, the mic and 'Do it ↵'", async () => {
    render(bar());
    await ready();
    const row2 = document.querySelector('[data-part="band-row2"]') as HTMLElement;
    expect([...row2.querySelectorAll("[data-chip]")].map((b) => b.textContent)).toEqual(["Call people", "WhatsApp", "Quote"]);
    expect(within(row2).getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    const doIt = within(row2).getByRole("button", { name: /Do it/ });
    expect(doIt).toHaveClass("ds-do");
    expect(doIt.querySelector("kbd")).toHaveTextContent("↵");
  });

  it("shows the cycling example as GHOST text when empty, and keeps the first with reduced motion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(bar());
    expect(ghost()).toBe(dict[PLACEHOLDER_KEYS[0]]);
    act(() => void vi.advanceTimersByTime(4600));
    expect(ghost()).toBe(dict[PLACEHOLDER_KEYS[1]]);
    fireEvent.focus(input());
    act(() => void vi.advanceTimersByTime(20_000));
    expect(ghost()).toBe(dict[PLACEHOLDER_KEYS[1]]);
    cleanup();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(bar());
    act(() => void vi.advanceTimersByTime(20_000));
    expect(ghost()).toBe(dict[PLACEHOLDER_KEYS[0]]);
  });

  it("completes what is typed with a ghost ending; Tab accepts it", async () => {
    render(bar());
    await ready();
    fireEvent.change(input(), { target: { value: "Call everyone who" } });
    expect(ghost()).toBe(" asked about wedding sarees this week");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input().value).toBe(dict[PLACEHOLDER_KEYS[0]]);
    expect(ghost()).toBe("");
  });

  it("Tab on an empty box takes the example in the ghost; with no ghost Tab leaves the field alone", async () => {
    render(bar());
    await ready();
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input().value).toBe(dict[PLACEHOLDER_KEYS[0]]);
    fireEvent.change(input(), { target: { value: "Something else entirely" } });
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(input().value).toBe("Something else entirely");
  });

  it("Cmd+K and Ctrl+K focus the composer from anywhere, and the key is not passed on", async () => {
    render(bar());
    await ready();
    document.body.focus();
    const seen = vi.fn();
    window.addEventListener("keydown", seen); // a bubbling listener (the menu's search, for one) does not hear it
    const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(document.activeElement).toBe(input());
    expect(ev.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    input().blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input());
    window.removeEventListener("keydown", seen);
  });

  it("a chip prefills the input (and focuses it) without sending anything", async () => {
    render(bar());
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(input().value).toBe(`${dict["tv6.chip.quote.fill"]} `);
    expect(document.activeElement).toBe(input());
    expect(asked).toEqual([]);
  });

  it("the language dropdown starts on the business's language, not Auto", async () => {
    const { unmount } = render(bar({ businessLang: "te" }));
    await ready();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("te");
    expect(document.querySelector('[data-chat="language"]')).toHaveTextContent("తెలుగు");
    unmount();
    window.localStorage.clear();
    render(bar());
    await ready();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en"); // no business language known: the app's, never Auto
  });

  it("'Do it' is always there; pressed with nothing written it focuses the input", async () => {
    render(bar());
    await ready();
    const doIt = screen.getByRole("button", { name: /Do it/ });
    expect(doIt).not.toBeDisabled();
    fireEvent.click(doIt);
    expect(document.activeElement).toBe(input());
    expect(asked).toEqual([]);
  });

  it("'Do it' goes into the EXISTING plan-card flow: a plan card with Approve; the instruction is planned, not asked", async () => {
    const a = actions();
    render(bar({ doIt: doIt(a) }));
    await ready();
    fireEvent.change(input(), { target: { value: "Call people who asked about wedding sarees" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Do it/ })));
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

  it("Enter is 'Do it' (where there is no plan mode the instruction is asked as a question)", async () => {
    render(bar({ doIt: null }));
    await ready();
    fireEvent.change(input(), { target: { value: "What needs me today?" } });
    await act(async () => void fireEvent.keyDown(input(), { key: "Enter" }));
    await waitFor(() => expect(asked).toEqual(["What needs me today?"]));
    expect(await screen.findByText("An ordinary answer.")).toBeInTheDocument();
  });

  it("while talking, the SAME box becomes the live conversation in place (no popup); End returns to the input, Type too", async () => {
    render(bar());
    await ready();
    const section = document.querySelector('[data-part="command-bar"]');
    act(() => setTalking(true));
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    expect(document.querySelector('[data-part="command-bar"]')).toBe(section);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(input()).toBeNull();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(input()).not.toBeNull());
    act(() => setTalking(true));
    fireEvent.click(await screen.findByRole("button", { name: "Type" }));
    await waitFor(() => expect(input()).not.toBeNull());
  });

  it("where the assistant is not on, the card's own old states are drawn (no new input)", () => {
    render(bar({ availability: "not_available" }));
    expect(document.getElementById("ask-input")).toBeNull();
    expect(document.querySelector("[data-v6]")).toBeNull();
  });
});
