import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Perf fix (b), 19 Nov 2026: Today starts the ask and voice requests (`ask/voice`, `voice-token`, `conversation` and what the restored thread carries) only when the composer or the orb is used,
// or when the browser is idle 4 s after load. The live-call bar is not part of it: a live call shows at once and its poll runs from the start.
beforeAll(async () => {
  await import("../ask/AskSessionHost");
  await import("../ask/ChatCardHost");
  await import("../ask/AskView");
  await import("../ask/conversation-api");
  await import("../ask/AskDoIt");
  await import("./LiveBar");
});
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/22222222-2222-2222-2222-222222222222", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const polled = vi.hoisted(() => ({ state: { calls: [] as unknown[], at: 0, status: "ok" }, use: vi.fn() }));
vi.mock("../../live/live-calls-store", () => ({
  useLiveCalls: (...a: unknown[]) => {
    polled.use(...a);
    return polled.state;
  },
  pokeLiveCalls: vi.fn(),
}));
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
import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import { AskProvider } from "../ask/AskProvider";
import { ASK_WORD_KEYS } from "../ask/ask-words";
import type { AskRequest, AskTransport } from "../ask/ask-types";
import type { BrowserVoice } from "../ask/browser-voice";
import { armIdleWake, IDLE_WAKE_MS, isAskAwake, resetAskWake, wakeAsk } from "../ask/ask-wake";
import { TodayBand, TodayBandAfter, type BandProps } from "./TodayBand";
import { setTalking } from "./v6-state";

vi.setConfig({ testTimeout: 15000 });

const T = "22222222-2222-2222-2222-222222222222";
const BASE = `/app/tenants/${T}`;
const dict = appDict("en") as Record<string, string>;
const en = appT("en");
const ASK = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const BV = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("bv.")));
const VOICE: BrowserVoice = { words: BV, url: "wss://x/v", language: "en", languageNames: CALL_LANG_NAMES, tokenUrl: `${BASE}/voice-token` };
const props = (over: Partial<BandProps> = {}): BandProps => ({
  lang: "en",
  base: BASE,
  availability: "live",
  greeting: "Good morning, Gowtham",
  dateLine: "Friday, 13 November",
  shop: "Sri Lakshmi Silks",
  facts: { enquiries: 14, visits: 4 },
  top: null,
  waiting: 3,
  tenantId: T,
  mockLive: null,
  words: WORDS,
  askWords: ASK,
  chips: [],
  language: "English",
  ...over,
});

const requests: AskRequest[] = [];
const transport: AskTransport = async function* (req) {
  requests.push(req);
  yield { type: "text", delta: "An ordinary answer." };
  yield { type: "done", conversationId: "c-last" };
};
// every network call the page makes, as "METHOD tail"
const seen: string[] = [];
let listGate: Promise<void> | null = null; // while set, the list of earlier conversations waits
const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) } as Response);
const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (u.endsWith("/ask/voice")) {
    seen.push(`${method} ask/voice`);
    return json({ available: true, speech: false });
  }
  if (u.endsWith("/voice-token")) {
    seen.push(`${method} voice-token`);
    return json({ token: "tok" });
  }
  if (u.endsWith("/conversation")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { op?: string };
    seen.push(`${method} conversation:${body.op}`);
    if (body.op === "list") {
      if (listGate) await listGate;
      return json({ items: [{ id: "c-last", title: "Earlier", updatedAt: "", messageCount: 2, lastText: "ok" }] });
    }
    if (body.op === "open") return json({ messages: [{ role: "user", text: "how many enquiries?" }, { role: "assistant", text: "Fourteen.", kind: null, action: null, sources: [] }] });
  }
  seen.push(`${method} ${u}`);
  return json({}, false);
};
const names = () => [...new Set(seen)];
const isAsk = (s: string) => /ask\/voice|voice-token|conversation/.test(s);
/** Waits until the page has been quiet for a moment (the DOM and the requests settle), instead of counting clock ticks. */
const settle = async () => {
  let last = -1;
  await waitFor(
    () => {
      const now = seen.length;
      const quiet = now === last;
      last = now;
      expect(quiet).toBe(true);
    },
    { timeout: 3000, interval: 60 },
  );
};

const bands = (over: Partial<BandProps> = {}) => (
  <AskProvider lang="en" base={BASE} words={ASK} chipWords={ASK} availability="live" transport={transport} voice={VOICE}>
    <TodayBand {...props(over)} />
    <TodayBandAfter words={WORDS} language="English" />
  </AskProvider>
);
const composer = () => document.getElementById("ask-input") as HTMLTextAreaElement;
const phoneBox = () => document.getElementById("phone-ask") as HTMLTextAreaElement;
const sessionReady = async () => {
  await waitFor(() => expect(composer()).not.toBeDisabled());
};

beforeEach(() => {
  seen.length = 0;
  requests.length = 0;
  listGate = null;
  resetAskWake();
  setTalking(false);
  polled.state = { calls: [], at: 0, status: "ok" };
  polled.use.mockClear();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  // a desktop that can record (so the voice check is asked for at all)
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
  vi.stubGlobal("MediaRecorder", Object.assign(function () {}, { isTypeSupported: () => true }));
});
afterEach(() => {
  cleanup();
  setTalking(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nothing of the ask and voice machinery runs at load", () => {
  it("makes no request to ask/voice, voice-token, conversation or the thread's links while nobody has touched the composer or the orb", async () => {
    render(bands());
    await sessionReady();
    await settle();
    expect(seen.filter(isAsk)).toEqual([]);
    expect(isAskAwake()).toBe(false);
    // the composer is there and ready, with its own text and no spinner
    expect(composer()).toBeInTheDocument();
    expect(document.querySelector('[data-part="ready"]')).toHaveTextContent("Ready to answer");
    expect(document.querySelector('[role="status"][data-part="talk-loading"]')).toBeNull();
  });

  it("a live call still shows at once and its poll runs from the start", async () => {
    render(bands({ liveCalls: [{ id: "55555555-5555-4555-8555-555555555555", who: "Padmaja Naidu", elapsedS: 84 }] }));
    // at mount, before the composer chunk or anything else has run
    expect(document.querySelector('[data-part="on-call"]')).toHaveTextContent(/On a call · Padmaja Naidu · 1:2\d/);
    expect(polled.use).toHaveBeenCalledWith(T, true);
    await sessionReady();
    await settle();
    expect(isAskAwake()).toBe(false); // (the live-call bar needs no wake)
    expect(seen.filter(isAsk)).toEqual([]);
  });
});

describe("the first use starts them", () => {
  it("focusing the composer starts the voice check, the earlier conversation (list, then open) and the voice sign-in", async () => {
    render(bands());
    await sessionReady();
    await settle();
    expect(seen.filter(isAsk)).toEqual([]);
    act(() => composer().focus());
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(["GET ask/voice", "POST conversation:list", "POST conversation:open", "POST voice-token"])));
    // the earlier conversation is only read (for a plan still waiting): it is NOT drawn, the box starts a new chat
    await settle();
    expect(document.body).not.toHaveTextContent("Fourteen.");
  });

  it("a press on the orb starts them too (before any focus)", async () => {
    render(bands());
    await sessionReady();
    await settle();
    fireEvent.pointerDown(document.querySelector('[data-part="band-orb"]') as HTMLElement);
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(["GET ask/voice", "POST conversation:list", "POST conversation:open"])));
  });

  it("a key in the composer (Cmd+K lands there) starts them; a press on a chip or the language box does too", async () => {
    render(bands());
    await sessionReady();
    await settle();
    fireEvent.keyDown(composer(), { key: "a" });
    await waitFor(() => expect(names()).toContain("GET ask/voice"));
  });

  it("on a phone the first focus of the 'Tell me' box starts them", async () => {
    render(bands());
    await sessionReady();
    await settle();
    expect(seen.filter(isAsk)).toEqual([]);
    act(() => phoneBox().focus());
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(["GET ask/voice", "POST conversation:list"])));
  });

  it("a press on the phone's hold-to-speak orb starts them", async () => {
    render(bands());
    await sessionReady();
    await settle();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Hold to speak" }));
    await waitFor(() => expect(names()).toContain("GET ask/voice"));
  });
});

describe("the idle prefetch", () => {
  it("starts 4 s after load (never during the first 3 s) and not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(bands());
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(isAskAwake()).toBe(false);
    expect(seen.filter(isAsk)).toEqual([]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(IDLE_WAKE_MS - 3000 - 1)));
    expect(isAskAwake()).toBe(false);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(isAskAwake()).toBe(true);
    vi.useRealTimers();
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(["GET ask/voice", "POST conversation:list"])));
  });

  it("uses requestIdleCallback when the browser has it, after the delay", () => {
    vi.useFakeTimers();
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 7;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    const cancel = armIdleWake();
    vi.advanceTimersByTime(IDLE_WAKE_MS - 1);
    expect(idle).not.toHaveBeenCalled();
    expect(isAskAwake()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(isAskAwake()).toBe(true);
    cancel();
  });

  it("is cancelled when the layout goes away, and does nothing once woken", () => {
    vi.useFakeTimers();
    const cancel = armIdleWake();
    cancel();
    vi.advanceTimersByTime(IDLE_WAKE_MS * 2);
    expect(isAskAwake()).toBe(false);
    wakeAsk();
    expect(armIdleWake()).toBeTypeOf("function");
  });
});

describe("the first send works whether or not the requests had started", () => {
  it("a send before anything started goes at once, in a NEW conversation (a reload starts a new chat)", async () => {
    let open: () => void = () => undefined;
    listGate = new Promise<void>((r) => (open = r));
    render(bands());
    await sessionReady();
    await settle();
    // no focus, no press: only the text and Enter (a paste, a prefilled box)
    fireEvent.change(composer(), { target: { value: "and today?" } });
    fireEvent.click(screen.getByRole("button", { name: /Do it/ }));
    await waitFor(() => expect(names()).toContain("POST conversation:list"));
    await waitFor(() => expect(requests.map((r) => r.question)).toEqual(["and today?"])); // not held by the earlier conversation's read
    open();
    expect(requests[0].conversationId).toBeFalsy(); // a new conversation
    expect(composer().value).toBe(""); // the box emptied once it went in
  });

  it("a second press while it waits does not send it twice", async () => {
    let open: () => void = () => undefined;
    listGate = new Promise<void>((r) => (open = r));
    render(bands());
    await sessionReady();
    fireEvent.change(composer(), { target: { value: "once" } });
    fireEvent.click(screen.getByRole("button", { name: /Do it/ }));
    fireEvent.click(screen.getByRole("button", { name: /Do it/ }));
    await waitFor(() => expect(names()).toContain("POST conversation:list"));
    open();
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await settle();
    expect(requests.map((r) => r.question)).toEqual(["once"]);
  });

  it("when the first focus had already started it and it has finished, a send goes in at once", async () => {
    render(bands());
    await sessionReady();
    act(() => composer().focus());
    await waitFor(() => expect(names()).toContain("POST conversation:open"));
    fireEvent.change(composer(), { target: { value: "next question" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(requests.map((r) => r.question)).toEqual(["next question"]));
    expect(requests[0].conversationId).toBeFalsy(); // a new conversation
  });

  it("a send on a phone before the box was focused works the same", async () => {
    render(bands());
    await sessionReady();
    fireEvent.change(phoneBox(), { target: { value: "from the phone" } });
    fireEvent.submit(phoneBox().closest("form") as HTMLFormElement);
    await waitFor(() => expect(requests.map((r) => r.question)).toEqual(["from the phone"]));
  });
});
