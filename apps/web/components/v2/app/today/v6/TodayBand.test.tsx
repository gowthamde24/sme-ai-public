import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await import("./LiveBar");
  await import("../ask/AskSessionHost");
  await import("../ask/AskDoIt");
  await import("../ask/work/WorkCards"); // the answer's work cards are lazy chunks: loaded up front, so none arrives after a test has ended
  await import("../ask/work/FilePreview");
  await import("../ask/work/PlanView");
  await import("../ask/work/SecretBox");
});
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/22222222-2222-2222-2222-222222222222", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const polled = vi.hoisted(() => ({ state: { calls: [] as unknown[], at: 0, status: "ok" } }));
vi.mock("../../live/live-calls-store", () => ({ useLiveCalls: () => polled.state }));
vi.mock("../../frame-store", () => ({ useFrameData: () => ({ live: true }) }));
vi.mock("../../live/LazyLiveNow", () => ({ LiveNow: () => <span data-testid="live-now">Watching for leads</span> }));
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
import { Briefing, TodayBand, TodayBandAfter, rich, type BandProps } from "./TodayBand";
import { setTalking, useTalking } from "./v6-state";

vi.setConfig({ testTimeout: 15000 });

const dict = appDict("en") as Record<string, string>;
const en = appT("en");
const T = "22222222-2222-2222-2222-222222222222";
const BASE = `/app/tenants/${T}`;
const ASK = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const DO_WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tk.") || k.startsWith("pc.")));
const TOP = { amountText: "₹24,500", name: "Kavya", href: `${BASE}/enquiries/E` };
const props = (over: Partial<BandProps> = {}): BandProps => ({
  lang: "en",
  base: BASE,
  availability: "live",
  greeting: "Good morning, Gowtham",
  dateLine: "Friday, 13 November",
  shop: "Sri Lakshmi Silks",
  facts: { enquiries: 14, visits: 4 },
  top: TOP,
  waiting: 3,
  tenantId: T,
  mockLive: null,
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
  polled.state = { calls: [], at: 0, status: "ok" };
  window.localStorage.clear();
  screenWidth(true);
});
afterEach(() => {
  cleanup();
  setTalking(false);
});

describe("rich strings", () => {
  it("makes the {places} of a sentence into pieces and keeps the rest whole", () => {
    const { container } = render(<p>{rich("Today: {a} and {b}. {missing}", { a: <b>one</b>, b: <i>two</i> })}</p>);
    expect(container.textContent).toBe("Today: one and two. {missing}");
    expect(container.querySelector("b")).toHaveTextContent("one");
  });
});

describe("the briefing", () => {
  it("says the facts of the day, the key ones bright, and the top decision as an underlined link to the quote", () => {
    render(<Briefing facts={{ enquiries: 14, visits: 4 }} top={TOP} waiting={3} words={WORDS} />);
    expect(document.querySelector('[data-part="briefing"]')).toHaveTextContent("14 new enquiries to look at and 4 visits booked today. One quote of ₹24,500 for Kavya is waiting for you.");
    expect(screen.getByRole("link", { name: "₹24,500 for Kavya" })).toHaveAttribute("href", TOP.href);
    expect(document.querySelector("b.ds-hl")).toHaveTextContent("4 visits booked");
  });
  it("without a quote the link opens the list of what waits; with nothing waiting it says so; a piece it cannot read is left out", () => {
    const { rerender } = render(<Briefing facts={{ enquiries: 1, visits: null }} top={null} waiting={3} words={WORDS} />);
    expect(document.querySelector('[data-part="briefing"]')).toHaveTextContent("1 new enquiry to look at. 3 things are waiting for you.");
    expect(screen.getByRole("link", { name: "3 things" })).toHaveAttribute("href", "#needs-you");
    rerender(<Briefing facts={{ enquiries: null, visits: 2 }} top={null} waiting={1} words={WORDS} />);
    expect(document.querySelector('[data-part="briefing"]')).toHaveTextContent("2 visits booked today. One thing is waiting for you.");
    rerender(<Briefing facts={{ enquiries: 0, visits: 0 }} top={null} waiting={0} words={WORDS} />);
    expect(document.querySelector('[data-part="briefing"]')).toHaveTextContent("Nothing is waiting for you.");
    rerender(<Briefing facts={{ enquiries: null, visits: null }} top={null} waiting={null} words={WORDS} />);
    expect(document.querySelector('[data-part="briefing"]')).toBeNull();
  });
  it("has no Approve button: that lives in Needs you", () => {
    render(<Briefing facts={{ enquiries: 14, visits: 4 }} top={TOP} waiting={3} words={WORDS} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Today's dark band on a desktop", () => {
  it("is the glossy dark band: the eyebrow (date · business · Ready to answer), the greeting, the briefing, the real orb with 'Tap to talk', and the composer", async () => {
    render(provider(<TodayBand {...props()} />));
    const band = document.querySelector('[data-part="band"]') as HTMLElement;
    expect(band).toHaveClass("ds-hero");
    expect(band.querySelector('[data-part="eyebrow"]')).toHaveTextContent("Friday, 13 November · Sri Lakshmi Silks");
    expect(band.querySelector('[data-part="ready"]')).toHaveTextContent("Ready to answer");
    expect(band.querySelector('[data-part="greeting"]')).toHaveTextContent("Good morning, Gowtham");
    expect(band.querySelector('[data-part="greeting"]')).toHaveClass("ds-greet");
    expect(band.querySelector('[data-part="briefing"]')).not.toBeNull();
    const orb = band.querySelector('[data-part="band-orb"]') as HTMLElement;
    expect(orb.querySelector("[data-orb]")).not.toBeNull();
    expect(orb.querySelector("canvas")).not.toBeNull();
    expect(orb).toHaveTextContent("Tap to talk");
    expect(band.querySelector('[data-part="command-bar"]')).not.toBeNull();
  });

  it("while a call is live the eyebrow turns red: 'On a call · name · 1:24 · Listen' (Listen opens the call)", () => {
    polled.state = { calls: [{ id: "55555555-5555-4555-8555-555555555555", who: "Meena", named: true, elapsedS: 84, answered: true, source: null, canTakeOver: true }], at: Date.now(), status: "ok" };
    render(provider(<TodayBand {...props()} />));
    const on = document.querySelector('[data-part="on-call"]') as HTMLElement;
    expect(on).toHaveTextContent(/On a call · Meena · 1:2\d/);
    expect(within(on).getByRole("link", { name: "Listen" })).toHaveAttribute("href", `${BASE}/calls/55555555-5555-4555-8555-555555555555`);
    expect(document.querySelector('[data-part="ready"]')).toBeNull();
  });

  it("a call the page read from the calls list (status live) turns the eyebrow red at once, before the poll has answered", () => {
    render(provider(<TodayBand {...props({ liveCalls: [{ id: "55555555-5555-4555-8555-555555555555", who: "Padmaja Naidu", elapsedS: 84 }] })} />));
    expect(document.querySelector('[data-part="on-call"]')).toHaveTextContent(/On a call · Padmaja Naidu · 1:2\d/);
    expect(document.querySelector('[data-part="ready"]')).toBeNull();
  });

  it("once the poll has answered with no call, a call that ended goes away", () => {
    polled.state = { calls: [], at: Date.now(), status: "ok" };
    render(provider(<TodayBand {...props({ liveCalls: [{ id: "55555555-5555-4555-8555-555555555555", who: "Padmaja Naidu", elapsedS: 84 }] })} />));
    expect(document.querySelector('[data-part="on-call"]')).toBeNull();
    expect(document.querySelector('[data-part="ready"]')).not.toBeNull();
  });

  it("the eyebrow is the date, the shop and the status only; 'Finish setup N/7' is a small chip on its own line under it; 'Watching for leads' is gone (owner, 13 Nov 2026)", () => {
    render(provider(<TodayBand {...props({ chip: <a data-part="finish-chip" href="#x">Finish setup · 5/7</a> })} />));
    const eye = document.querySelector('[data-part="eyebrow"]') as HTMLElement;
    expect(eye).toHaveTextContent("Sri Lakshmi Silks");
    expect(eye.querySelector('[data-part="ready"]')).not.toBeNull();
    expect(within(eye).queryByText("Finish setup · 5/7")).toBeNull();
    const chips = document.querySelector('[data-part="eyebrow-chips"]') as HTMLElement;
    expect(chips).toHaveTextContent("Finish setup · 5/7");
    expect(eye.nextElementSibling).toBe(chips);
    expect(document.querySelector('[data-part="eyebrow-live"]')).toBeNull();
    expect(document.body).not.toHaveTextContent("Watching for leads");
  });

  it("on a phone the first lines are compact: the date and the shop on one line, the status on its own line without the left border, and the chip on one line that never wraps", () => {
    render(provider(<TodayBand {...props({ chip: <a data-part="finish-chip" href="#x">Finish setup · 5/7</a> })} />));
    const eye = document.querySelector('[data-part="eyebrow"]') as HTMLElement;
    const first = eye.firstElementChild as HTMLElement;
    expect(first).toHaveClass("max-md:basis-full");
    expect(first).toHaveTextContent("Sri Lakshmi Silks");
    expect(eye.querySelector('[data-part="ready"]')).toHaveClass("max-md:basis-full", "max-md:border-0", "max-md:pl-0");
    const chips = document.querySelector('[data-part="eyebrow-chips"]') as HTMLElement;
    expect(chips).toHaveClass("flex-nowrap", "whitespace-nowrap");
    expect(chips.querySelector('[data-part="eyebrow-chip"]')).not.toBeNull();
  });

  it("a demo workspace offers Start demo call next to the status; Start asks the action once, End shows while a call is live, and a refusal says so in words", async () => {
    const start = vi.fn(async () => ({ ok: true }));
    const end = vi.fn(async () => ({ ok: true }));
    polled.state = { calls: [], at: Date.now(), status: "ok" };
    const { unmount } = render(provider(<TodayBand {...props({ demoCall: { start, end } })} />));
    fireEvent.click(screen.getByRole("button", { name: "Start demo call" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(end).not.toHaveBeenCalled();
    unmount();
    cleanup();
    start.mockResolvedValueOnce({ ok: false });
    render(provider(<TodayBand {...props({ demoCall: { start, end } })} />));
    fireEvent.click(screen.getByRole("button", { name: "Start demo call" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't do that. Try again.");
  });

  it("no demoCall = no button (any other workspace)", () => {
    render(provider(<TodayBand {...props()} />));
    expect(screen.queryByRole("button", { name: /demo call/i })).toBeNull();
  });

  it("while a call is live the button says End demo call and ends it", async () => {
    const end = vi.fn(async () => ({ ok: true }));
    render(provider(<TodayBand {...props({ demoCall: { start: vi.fn(async () => ({ ok: true })), end }, liveCalls: [{ id: "55555555-5555-4555-8555-555555555555", who: "Padmaja Naidu", elapsedS: 84 }] })} />));
    polled.state = { calls: [], at: 0, status: "ok" };
    fireEvent.click(await screen.findByRole("button", { name: "End demo call" }));
    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
  });

  it("the staging call (mock) is a live call too", () => {
    render(provider(<TodayBand {...props({ mockLive: { caller: "Ravi Kumar" } })} />));
    expect(document.querySelector('[data-part="on-call"]')).toHaveTextContent("On a call · Ravi Kumar");
  });

  it("tapping the orb turns the composer into the live conversation in place, and the orb follows what it does", async () => {
    render(provider(<TodayBand {...props()} />));
    const orb = document.querySelector('[data-part="band-orb"]') as HTMLElement;
    fireEvent.click(orb);
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(orb.querySelector("[data-orb]")).toHaveAttribute("data-orb", "listen"));
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(document.getElementById("ask-input")).not.toBeNull());
    await waitFor(() => expect(orb.querySelector("[data-orb]")).toHaveAttribute("data-orb", "ambient"));
  });

  it("has no suggested row, no status card and no 'Find customers' chip (the final design has none)", () => {
    render(provider(<TodayBand {...props()} />));
    expect(document.querySelector('[data-part="suggested"]')).toBeNull();
    expect(document.querySelector('[data-part="status-card"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Find customers" })).toBeNull();
  });
});

describe("Today on a phone (below 768 px)", () => {
  beforeEach(() => screenWidth(false));
  it("is a compact band: the greeting, the briefing and a small orb (tap = talk live)", async () => {
    render(provider(<TodayBand {...props()} />));
    const small = document.querySelector('[data-part="phone-orb"]') as HTMLElement;
    expect(small).toHaveClass("md:hidden");
    expect(small.querySelector("[data-orb]")).not.toBeNull();
    expect(document.querySelector('[data-part="briefing"]')).not.toBeNull();
    fireEvent.click(small);
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.queryByText(/LIVE WITH YOUR ASSISTANT/)).toBeNull());
  });

  it("has a fixed bottom bar with the orb in its 'Hold to speak' button, a pill to write in, and 'Hold to speak in <language>' under it", () => {
    render(provider(<TodayBandAfter words={WORDS} language="English" businessLang="te" />));
    const bar = document.querySelector('[data-part="phone-bar"]') as HTMLElement;
    expect(bar).toHaveClass("fixed", "md:hidden");
    expect(within(bar).getByPlaceholderText("Tell me what to do…")).toBeInTheDocument();
    const hold = within(bar).getByRole("button", { name: "Hold to speak" });
    expect(hold.querySelector("[data-orb]")).not.toBeNull();
    expect(bar.querySelector('[data-part="hold-hint"]')).toHaveTextContent("Hold to speak in తెలుగు");
  });

  it("press and hold is the mock talk: the bar says 'Release to send' while held and the conversation opens in the band", async () => {
    function Talking() {
      return <span data-testid="talking">{String(useTalking())}</span>;
    }
    render(provider(<><Talking /><TodayBand {...props()} /><TodayBandAfter words={WORDS} /></>));
    const hold = screen.getByRole("button", { name: "Hold to speak" });
    fireEvent.pointerDown(hold, { pointerType: "touch", button: 0 });
    expect(screen.getByRole("button", { name: "Release to send" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="hold-hint"]')).toHaveTextContent("Release to send");
    expect(screen.getByTestId("talking")).toHaveTextContent("true");
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    fireEvent.pointerUp(screen.getByRole("button", { name: "Release to send" }));
    expect(screen.getByRole("button", { name: "Hold to speak" })).toBeInTheDocument();
    expect(screen.getByTestId("talking")).toHaveTextContent("true"); // letting go keeps the conversation going; End stops it
  });

  it("a keyboard or screen reader: one press opens the conversation, the next closes it", () => {
    render(provider(<TodayBandAfter words={WORDS} />));
    const hold = screen.getByRole("button", { name: "Hold to speak" });
    fireEvent.click(hold, { detail: 0 });
    expect(hold).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hold, { detail: 0 });
    expect(hold).toHaveAttribute("aria-pressed", "false");
  });

  it("an instruction written in the bar makes a plan card (nothing runs)", async () => {
    render(provider(<><TodayBand {...props()} /><TodayBandAfter words={WORDS} /></>));
    await waitFor(() => expect(screen.getByPlaceholderText("Tell me what to do…")).toBeInTheDocument());
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText("Tell me what to do…"), { target: { value: "Call my new enquiries" } });
    await act(async () => void fireEvent.submit(screen.getByPlaceholderText("Tell me what to do…").closest("form") as HTMLFormElement));
    await waitFor(() => expect(planAction).toHaveBeenCalledTimes(1));
    expect((planAction.mock.calls[0] as unknown[])[1]).toBe("Call my new enquiries");
  });
});
