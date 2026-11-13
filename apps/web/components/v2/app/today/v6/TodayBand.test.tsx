import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await import("./LiveBar");
  await import("../ask/AskSessionHost");
  await import("../ask/AskDoIt");
});
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/22222222-2222-2222-2222-222222222222", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../live/live-calls-store", () => ({ useLiveCalls: () => ({ calls: [], at: 0, status: "ok" }) }));
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
import type { AskTransport } from "../ask/ask-types";
import type { DoItOptions } from "../ask/use-do-it";
import type { Suggestion } from "./band-data";
import { SuggestedRow } from "./SuggestedRow";
import { TodayBand, TodayBandAfter, type BandProps } from "./TodayBand";
import { setTalking, useTalking } from "./v6-state";

vi.setConfig({ testTimeout: 15000 });

const dict = appDict("en") as Record<string, string>;
const en = appT("en");
const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const ASK = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const DO_WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.")));
const SUGGESTIONS: Suggestion[] = [
  { id: "leads", n: 5, est: { costText: "about ₹45", timeText: "about 10 min", totalMinutes: 10 }, amountPaise: null },
  { id: "quotes", n: 2, est: null, amountPaise: 4_800_000 },
];
const props = (over: Partial<BandProps> = {}): BandProps => ({
  lang: "en",
  base: BASE,
  availability: "live",
  greeting: "Good morning, Gowtham",
  dateLine: "Friday, 13 November",
  facts: { enquiries: 4, visits: 2, quotesPaise: 4_800_000 },
  waiting: 3,
  suggestions: SUGGESTIONS,
  status: { number: "+91 ••••• ••421", last: null, nextUp: null, counts: { waiting: 3, visits: 2, enquiries: 4 }, testHref: `${BASE}/calls`, callsHref: `${BASE}/calls`, phoneHref: `${BASE}/phone-number`, tenantId: "22222222-2222-2222-2222-222222222222", mock: null },
  words: WORDS,
  askWords: ASK,
  chips: [],
  language: "English",
  ...over,
});
const screenWidth = (desktop: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("min-width") ? desktop : false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
};
const transport: AskTransport = async function* () {
  yield { type: "done" };
};
const task = () =>
  parseTask({ id: "33333333-3333-4333-8333-333333333333", status: "planned", instruction: "x", language: "en", template: "offer_invite", question: null, plan: { channel: "call", goal: "Call.", questions: [], script_notes: "", message_text: null, window: { date: "2026-11-13", from_minute: 600, to_minute: 1020 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 5, contacts_sample: [], unmatched: [], notes: [] }, estimate: { contacts: 5, calls: 5, messages: 0, minutes: 10, cost_paise: 4500, basis: "fake" }, cap_paise: 6000, spent_paise: 0, pause_reason: null, progress: { total: 5, excluded: 0, waiting: 5, in_progress: 0, done: 0, failed: 0, skipped: 0, reached: 0, positive: 0 }, plan_sha256: "ab".repeat(32), simulated: true, wording: "draft", created_at: "2026-11-13T05:00:00Z", approved_at: null, finished_at: null });
const planAction = vi.fn(() => Promise.resolve({ ok: true as const, task: task() }));
const doIt: DoItOptions = { actions: { plan: planAction, templates: () => Promise.resolve({ ok: true as const, templates: [] }) } as unknown as TaskActions, powers: { plan: true, approve: true, move: true }, words: DO_WORDS };
const provider = (children: React.ReactNode) => (
  <AskProvider lang="en" base={BASE} words={ASK} chipWords={ASK} availability="live" transport={transport} voiceStatus={null} doIt={doIt}>
    {children}
  </AskProvider>
);

beforeEach(() => {
  setTalking(false);
  planAction.mockClear();
  window.localStorage.clear();
  screenWidth(true);
});
afterEach(() => {
  cleanup();
  setTalking(false);
});

describe("the suggested row", () => {
  it("draws each job with its time and ₹ and ONE button, in one line on a desktop", () => {
    render(<SuggestedRow items={SUGGESTIONS} words={WORDS} variant="row" onStart={() => undefined} />);
    const items = [...document.querySelectorAll("[data-suggestion]")];
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Call 5 new enquiries");
    expect(items[0]).toHaveTextContent("about 10 min · about ₹45");
    expect(items[1]).toHaveTextContent("Approve 2 waiting quotes");
    expect(items[1]).toHaveTextContent("₹48,000 · about 2 min");
    for (const li of items) expect(within(li as HTMLElement).getAllByRole("button")).toHaveLength(1);
    expect(document.querySelector('[data-part="suggested"]')).toHaveClass("max-md:hidden");
  });
  it("hands the job's instruction on when Start is pressed", () => {
    const onStart = vi.fn();
    render(<SuggestedRow items={SUGGESTIONS} words={WORDS} variant="row" onStart={onStart} />);
    fireEvent.click(within(document.querySelector('[data-suggestion="leads"]') as HTMLElement).getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith("Call my 5 new enquiries");
  });
  it("is cards you swipe sideways on a phone (scroll-snap) and draws nothing when there is nothing to suggest", () => {
    const { container } = render(<SuggestedRow items={SUGGESTIONS} words={WORDS} variant="swipe" onStart={() => undefined} />);
    expect(container.querySelector("ul")).toHaveClass("snap-x", "snap-mandatory", "overflow-x-auto");
    expect(container.querySelector("section")).toHaveClass("md:hidden");
    cleanup();
    const empty = render(<SuggestedRow items={[]} words={WORDS} variant="row" onStart={() => undefined} />);
    expect(empty.container).toBeEmptyDOMElement();
  });
});

describe("Today's top band on a desktop", () => {
  it("greets, says the day with enquiries, visits and ₹ in quotes on one line, and has the command bar, the suggestions and the status card", async () => {
    render(provider(<TodayBand {...props()} />));
    expect(document.querySelector('[data-part="greeting"]')).toHaveTextContent("Good morning, Gowtham");
    expect(document.querySelector('[data-part="band-line"]')).toHaveTextContent("Friday, 13 November · 4 new enquiries · 2 visits booked · ₹48,000 in quotes");
    expect(document.querySelector('[data-part="command-bar"]')).not.toBeNull();
    expect(document.querySelector('[data-part="status-card"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-part="suggested"][data-variant="row"] [data-suggestion]')).toHaveLength(2);
  });
  it("leaves out a piece of the line that cannot be read", () => {
    render(provider(<TodayBand {...props({ facts: { enquiries: null, visits: 1, quotesPaise: null } })} />));
    expect(document.querySelector('[data-part="band-line"]')).toHaveTextContent("Friday, 13 November · 1 visit booked");
  });
  it("a suggested job's Start goes into the plan flow (a plan is made; nothing runs)", async () => {
    render(provider(<TodayBand {...props()} />));
    await waitFor(() => expect(document.getElementById("ask-input")).not.toBeDisabled());
    await act(async () => void fireEvent.click(within(document.querySelector('[data-suggestion="leads"]') as HTMLElement).getByRole("button", { name: "Start" })));
    await waitFor(() => expect(planAction).toHaveBeenCalledTimes(1));
    expect((planAction.mock.calls[0] as unknown[])[1]).toBe("Call my 5 new enquiries");
    expect(await screen.findByRole("button", { name: /Approve all/ })).toBeInTheDocument();
  });
});

describe("Today on a phone (below 768 px)", () => {
  beforeEach(() => screenWidth(false));
  it("has the greeting and the daily headline; its one orb is in the bottom bar, not up here", () => {
    render(provider(<><TodayBand {...props()} /><TodayBandAfter suggestions={SUGGESTIONS} words={WORDS} /></>));
    const head = document.querySelector('[data-part="phone-head"]') as HTMLElement;
    expect(head).toHaveClass("md:hidden", "min-w-0");
    expect(head.querySelector("[data-orb]")).toBeNull();
    expect(within(head).getByText("3 things need you")).toBeInTheDocument();
    expect(within(head).getByRole("heading", { name: "Good morning, Gowtham" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-part="phone-bar"] [data-orb]')).toHaveLength(1);
  });
  it("tapping the bar's orb is talk-live mode in place at the top; End returns", async () => {
    render(provider(<><TodayBand {...props()} /><TodayBandAfter suggestions={[]} words={WORDS} /></>));
    fireEvent.click(within(document.querySelector('[data-part="phone-bar"]') as HTMLElement).getByRole("button", { name: "Talk live" }));
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByText("3 things need you")).toBeInTheDocument());
  });
  it("swipeable suggestions come after Needs you, with a fixed bottom bar and a big mic 'Hold to speak'", () => {
    render(provider(<TodayBandAfter suggestions={SUGGESTIONS} words={WORDS} />));
    expect(document.querySelector('[data-variant="swipe"]')).not.toBeNull();
    const bar = document.querySelector('[data-part="phone-bar"]') as HTMLElement;
    expect(bar).toHaveClass("fixed", "md:hidden");
    expect(within(bar).getByRole("button", { name: "Hold to speak" })).toBeInTheDocument();
  });
  it("press and hold is the mock talk: the bar says 'Release to send' while held and the conversation opens", async () => {
    function Talking() {
      return <span data-testid="talking">{String(useTalking())}</span>;
    }
    render(provider(<><Talking /><TodayBand {...props()} /><TodayBandAfter suggestions={SUGGESTIONS} words={WORDS} /></>));
    const hold = screen.getByRole("button", { name: "Hold to speak" });
    fireEvent.pointerDown(hold, { pointerType: "touch", button: 0 });
    expect(screen.getByRole("button", { name: "Release to send" })).toBeInTheDocument();
    expect(screen.getByTestId("talking")).toHaveTextContent("true");
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    fireEvent.pointerUp(screen.getByRole("button", { name: "Release to send" }));
    expect(screen.getByRole("button", { name: "Hold to speak" })).toBeInTheDocument();
    expect(screen.getByTestId("talking")).toHaveTextContent("true"); // letting go keeps the conversation going; End stops it
  });
  it("a keyboard or screen reader: one press opens the conversation, the next closes it", () => {
    render(provider(<TodayBandAfter suggestions={[]} words={WORDS} />));
    const hold = screen.getByRole("button", { name: "Hold to speak" });
    fireEvent.click(hold, { detail: 0 });
    expect(hold).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hold, { detail: 0 });
    expect(hold).toHaveAttribute("aria-pressed", "false");
  });
  it("starting a swipe card makes a plan card on the phone too", async () => {
    render(provider(<TodayBandAfter suggestions={SUGGESTIONS} words={WORDS} />));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Start" }).length).toBeGreaterThan(0));
    await act(async () => void fireEvent.click(within(document.querySelector('[data-suggestion="leads"]') as HTMLElement).getByRole("button", { name: "Start" })));
    await waitFor(() => expect(planAction).toHaveBeenCalledTimes(1));
  });
});
