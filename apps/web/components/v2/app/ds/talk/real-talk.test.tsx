import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";

import { AskVoiceContext } from "../../today/ask/ask-store";
import type { BrowserVoice } from "../../today/ask/browser-voice";
import { LevelBars, TalkLiveBody } from "./TalkLive";
import { planOf, REAL_CONNECT_MS, useRealTalk } from "./use-real-talk";
import { useTalkLive, type TalkLive } from "./use-talk-live";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("dst.") || k.startsWith("tv6.talk.") || k.startsWith("bv.")));
const json = (o: unknown): string => JSON.stringify(o);
const ACTION = "55555555-5555-4555-8555-555555555555";
const BASE = "/app/tenants/22222222-2222-4222-8222-222222222222";
const VOICE = { url: "wss://x/v1/tenants/t/voice-chat", tokenUrl: `${BASE}/voice-token`, language: "te", words: {}, languageNames: {} } as unknown as BrowserVoice;

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(m: unknown) {
    this.onmessage?.({ data: typeof m === "string" ? m : json(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  types() {
    return this.sent.map((s) => (typeof s === "string" ? (JSON.parse(s) as { type: string }).type : "audio"));
  }
}
function fakeAudio(opts: { deny?: boolean } = {}) {
  let frame: ((pcm: ArrayBuffer, level: number) => void) | null = null;
  const calls = { closed: 0, micStopped: 0, muted: [] as boolean[] };
  const io: AudioIO = {
    startMic: async (cb) => {
      if (opts.deny) throw new Error("NotAllowedError");
      frame = cb;
    },
    stopMic: () => void calls.micStopped++,
    mute: (on) => void calls.muted.push(on),
    play: () => undefined,
    flush: () => undefined,
    playing: () => false,
    close: () => void calls.closed++,
    analyser: () => null,
  };
  return { io, calls, frame: (level = 0.01) => frame?.(new ArrayBuffer(640), level) };
}

let sockets: FakeSocket[];
let audio: ReturnType<typeof fakeAudio>;
const confirm = vi.fn();
const setup = (over: { deny?: boolean } = {}) => {
  audio = fakeAudio(over);
  return renderHook(() => useRealTalk(VOICE, { base: BASE, audioFactory: () => audio.io, socketFactory: () => (sockets.push(new FakeSocket()), sockets.at(-1) as FakeSocket), confirm }));
};
const flush = () => act(async () => void (await Promise.resolve()));
const begin = async (hook: ReturnType<typeof setup>) => {
  act(() => hook.result.current.start());
  await flush();
  await flush();
};
const ready = async (hook: ReturnType<typeof setup>) => {
  await begin(hook);
  const s = sockets.at(-1) as FakeSocket;
  act(() => {
    s.open();
    s.say({ type: "ready", session_id: "s", language: "te", limits: { session_seconds: 600 } });
    s.say({ type: "state", state: "listening", step: null });
  });
};

beforeEach(() => {
  sockets = [];
  confirm.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok" }) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Talk live with the real voice", () => {
  it("is idle until start(); a tap that the browser refuses (microphone blocked) says so in words, with Try again, and no socket is opened", async () => {
    const h = setup({ deny: true });
    expect(h.result.current).toMatchObject({ real: true, active: false });
    await begin(h);
    expect(sockets).toHaveLength(0); // the socket is opened only after the microphone said yes
    expect(h.result.current.problem).toEqual({ kind: "mic", word: null, retry: true });
    expect(h.result.current.active).toBe(true); // the bar stays, showing why
  });

  it("a socket that never opens is 'Couldn't connect' with Try again; Try again opens a new one and it can work", async () => {
    const h = setup();
    await begin(h);
    act(() => sockets[0].drop(1006));
    expect(h.result.current.problem).toEqual({ kind: "connect", word: null, retry: true });
    act(() => h.result.current.retry!());
    await flush();
    await flush();
    expect(sockets).toHaveLength(2);
    expect(h.result.current.problem).toBeNull();
    act(() => {
      sockets[1].open();
      sockets[1].say({ type: "ready", session_id: "s", language: "te", limits: {} });
    });
    expect(h.result.current.connecting).toBe(false);
    expect(h.result.current.problem).toBeNull();
  });

  it("a socket that opens but never says ready ends in 'Couldn't connect' after the wait, never silence", async () => {
    vi.useFakeTimers();
    const h = setup();
    act(() => h.result.current.start());
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    act(() => sockets[0].open());
    expect(h.result.current.connecting).toBe(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(REAL_CONNECT_MS + 10)));
    expect(h.result.current.problem?.kind).toBe("connect");
  });

  it("the token cannot be had: Couldn't connect, and no microphone is opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const h = setup();
    await begin(h);
    expect(h.result.current.problem?.kind).toBe("connect");
    expect(sockets).toHaveLength(0);
  });

  it("maps the API's states (paused counts as listening) and draws the words as they come: the person's interim words are replaced in place, the assistant's grow", async () => {
    const h = setup();
    await ready(h);
    const s = sockets[0];
    expect(h.result.current.state).toBe("listening");
    act(() => s.say({ type: "state", state: "thinking", step: "working" }));
    expect(h.result.current.state).toBe("thinking");
    act(() => s.say({ type: "state", state: "paused" }));
    expect(h.result.current.state).toBe("listening");
    act(() => {
      s.say({ type: "state", state: "listening" });
      s.say({ type: "transcript", text: "call every", final: false });
    });
    act(() => s.say({ type: "transcript", text: "call everyone who asked about silk", final: true }));
    act(() => {
      s.say({ type: "state", state: "speaking" });
      s.say({ type: "caption", who: "assistant", text: "Found 14 ", final: false, spoken: true });
    });
    expect(h.result.current.state).toBe("speaking");
    expect(h.result.current.lines).toEqual([
      { who: "owner", text: "call everyone who asked about silk" },
      { who: "assistant", text: "Found 14 " },
    ]);
  });

  it("the plan card comes from confirm_action with only the numbers the API gave (no invented calling hours); Yes sends 'yes' to this workspace and shows the API's state", async () => {
    confirm.mockResolvedValue({ ok: true, status: "confirmed" });
    const h = setup();
    await ready(h);
    act(() => sockets[0].say({ type: "confirm_action", action_id: ACTION, title: "Call 14 people", summary: "About silk sarees", steps: ["Call", "Offer a visit"], count: 14, channel: "call", estimate: { messages: 0, call_minutes: 40, cost_paise: 18000 }, expires_at: "2026-11-14T00:00:00Z" }));
    expect(h.result.current.plan).toMatchObject({ what: "Call 14 people", people: 14, minutes: 40, cost: "₹180", channel: "call", time: "", hours: "" });
    expect(h.result.current.planStatus).toBe("proposed");
    await act(async () => h.result.current.decide("yes"));
    expect(confirm).toHaveBeenCalledWith(BASE, ACTION, "yes");
    expect(h.result.current.planStatus).toBe("confirmed");
    expect(h.result.current.answer).toBe("yes");
  });

  it("Change declines the plan and the person goes on talking; a refusal (two-step code) is a plain-words key, not silence", async () => {
    confirm.mockResolvedValueOnce({ ok: false, error: "mfa" }).mockResolvedValueOnce({ ok: true, status: "declined" });
    const h = setup();
    await ready(h);
    act(() => sockets[0].say({ type: "confirm_action", action_id: ACTION, title: "T", summary: "S", steps: [], count: null, channel: null, estimate: null }));
    await act(async () => h.result.current.decide("yes"));
    expect(h.result.current.planError).toBe("bv.chat.err.mfa");
    expect(h.result.current.planStatus).toBe("proposed");
    await act(async () => h.result.current.decide("change"));
    expect(confirm).toHaveBeenLastCalledWith(BASE, ACTION, "no");
    expect(h.result.current.planStatus).toBe("declined");
    expect(h.result.current.answer).toBe("change");
    expect(h.result.current.active).toBe(true);
  });

  it("a spoken 'yes' the API recognised (the `action` message) updates the card without a tap", async () => {
    const h = setup();
    await ready(h);
    act(() => sockets[0].say({ type: "confirm_action", action_id: ACTION, title: "T", summary: "S", steps: [], count: null, channel: null, estimate: null }));
    act(() => sockets[0].say({ type: "action", action_id: ACTION, status: "confirmed" }));
    expect(h.result.current.planStatus).toBe("confirmed");
    expect(h.result.current.answer).toBe("yes");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a tap while it speaks cuts it off (barge-in) and it listens", async () => {
    const h = setup();
    await ready(h);
    act(() => sockets[0].say({ type: "state", state: "speaking" }));
    act(() => h.result.current.bargeIn!());
    expect(sockets[0].types()).toContain("barge_in");
    expect(h.result.current.state).toBe("listening");
  });

  it("Mute really stops: the microphone track is turned off and no audio frame is sent; unmuting sends again", async () => {
    const h = setup();
    await ready(h);
    act(() => audio.frame());
    const before = sockets[0].types().filter((x) => x === "audio").length;
    expect(before).toBe(1);
    act(() => h.result.current.toggleMute());
    expect(h.result.current.muted).toBe(true);
    expect(audio.calls.muted).toEqual([true]);
    act(() => audio.frame());
    act(() => audio.frame());
    expect(sockets[0].types().filter((x) => x === "audio")).toHaveLength(before);
    act(() => h.result.current.toggleMute());
    act(() => audio.frame());
    expect(sockets[0].types().filter((x) => x === "audio")).toHaveLength(before + 1);
  });

  it("End turns the microphone off, tells the API and goes back to normal; the same when the page goes away", async () => {
    const h = setup();
    await ready(h);
    act(() => h.result.current.end());
    expect(sockets[0].types()).toContain("stop");
    expect(audio.calls.micStopped).toBeGreaterThan(0);
    expect(h.result.current).toMatchObject({ active: false, lines: [], plan: null, muted: false });
    const g = setup();
    await ready(g);
    g.unmount();
    expect(audio.calls.micStopped).toBeGreaterThan(0);
  });

  it("the microphone is off the moment the tab is hidden, and the conversation ends quietly", async () => {
    const h = setup();
    await ready(h);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(sockets[0].types()).toContain("stop");
    expect(audio.calls.micStopped).toBeGreaterThan(0);
    expect(h.result.current.finished).toBe(true);
  });

  it("the API's own reasons are said in words: the time limit offers a new one, 'busy' and 'daily' use the existing sentences; a goodbye just closes", async () => {
    const h = setup();
    await ready(h);
    act(() => {
      sockets[0].say({ type: "limit", reason: "session" });
      sockets[0].drop(1000);
    });
    expect(h.result.current.problem).toEqual({ kind: "end", word: "session", retry: true });
    const g = setup();
    await ready(g);
    const s = sockets[1];
    act(() => {
      s.say({ type: "error", code: "busy", message: "open elsewhere", fatal: true });
      s.drop(4429);
    });
    expect(g.result.current.problem).toEqual({ kind: "end", word: "busy", retry: true });
    const d = setup();
    await ready(d);
    const t = sockets[2];
    act(() => {
      t.say({ type: "limit", reason: "daily_limit" });
      t.drop(1000);
    });
    expect(d.result.current.problem).toEqual({ kind: "end", word: "daily", retry: false });
    const b = setup();
    await ready(b);
    const u = sockets[3];
    act(() => {
      u.say({ type: "limit", reason: "goodbye" });
      u.drop(1000);
    });
    expect(b.result.current.problem).toBeNull();
    expect(b.result.current.finished).toBe(true);
  });

  it("a line that drops while talking is 'lost' with Try again; the session_ending notice shows the time left", async () => {
    const h = setup();
    await ready(h);
    act(() => sockets[0].say({ type: "notice", code: "session_ending", seconds_left: 45 }));
    await flush();
    expect(h.result.current.notice?.kind).toBe("ending");
    act(() => sockets[0].drop(1006));
    expect(h.result.current.problem).toEqual({ kind: "lost", word: "unavailable", retry: true });
  });

  it("planOf never invents calling hours or a cost", () => {
    expect(planOf({ actionId: ACTION, title: "T", summary: "S", steps: [], count: null, channel: null, estimate: null, needsSecondFactor: false, expiresAt: "", status: "proposed" })).toMatchObject({ cost: "", time: "", hours: "", people: null, minutes: null });
  });
});

describe("which conversation the screen uses", () => {
  const wrap = (voice: BrowserVoice | null) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => <AskVoiceContext.Provider value={voice}>{children}</AskVoiceContext.Provider>;
    return Wrapper;
  };
  it("with no voice (flag off, a test) the made-up conversation stays, and it labels itself a preview", () => {
    vi.useFakeTimers();
    const h = renderHook(() => useTalkLive("command"), { wrapper: wrap(null) });
    expect(h.result.current.real).toBeUndefined();
    act(() => h.result.current.start());
    act(() => void vi.advanceTimersByTime(1300));
    expect(h.result.current.lines).toHaveLength(1);
  });
  it("with the page's voice (BROWSER_VOICE on) it is the real one: nothing is played on start", () => {
    const h = renderHook(() => useTalkLive("command"), { wrapper: wrap(VOICE) });
    expect(h.result.current.real).toBe(true);
    expect(h.result.current.lines).toEqual([]);
  });
});

describe("the bar says what the real conversation is doing", () => {
  const live = (over: Partial<TalkLive> = {}): TalkLive => ({ real: true, active: true, state: "listening", seconds: 5, lines: [], plan: null, answer: null, muted: false, start: vi.fn(), end: vi.fn(), toggleMute: vi.fn(), decide: vi.fn(), ...over });
  for (const variant of ["bar", "card"] as const) {
    it(`${variant}: 'Couldn't connect · Try again' with a working button; a blocked microphone says how to allow it; no preview label`, () => {
      const retry = vi.fn();
      render(<TalkLiveBody variant={variant} live={live({ problem: { kind: "connect", word: null, retry: true }, retry })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't connect");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(retry).toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent("made up");
      cleanup();
      render(<TalkLiveBody variant={variant} live={live({ problem: { kind: "mic", word: null, retry: true }, retry })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Click the lock beside the address");
    });
    it(`${variant}: connecting, muted, interrupt while it speaks, a real plan with its numbers and no calling hours, and its state after Yes`, () => {
      const bargeIn = vi.fn();
      const plan = { what: "Call 14 people", summary: "About silk", time: "", cost: "₹180", hours: "", people: 14, messages: 0, minutes: 40, channel: "call" as const };
      render(<TalkLiveBody variant={variant} live={live({ connecting: true })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(document.querySelector('[data-part="talk-label"]')).toHaveTextContent("CONNECTING");
      cleanup();
      render(<TalkLiveBody variant={variant} live={live({ muted: true })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(screen.getByText("Muted. Nothing you say is heard.")).toBeInTheDocument();
      cleanup();
      render(<TalkLiveBody variant={variant} live={live({ state: "speaking", bargeIn, plan, planStatus: "proposed" })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
      expect(bargeIn).toHaveBeenCalled();
      const card = document.querySelector('[data-part="talk-plan"]') as HTMLElement;
      expect(card).toHaveTextContent("14 people · about 40 call minutes · by phone call · ₹180");
      expect(card.textContent).not.toMatch(/hours/i);
      expect(screen.getByRole("button", { name: "Yes, start" })).toBeInTheDocument();
      cleanup();
      render(<TalkLiveBody variant={variant} live={live({ plan, planStatus: "confirmed", answer: "yes" })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(screen.queryByRole("button", { name: "Yes, start" })).toBeNull();
      expect(document.querySelector('[data-part="talk-answer"]')).toHaveTextContent("Approved. It is being done.");
    });
  }
  it("the sound bars follow the analyser's loudness (and stand by themselves without one)", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const analyser = { fftSize: 16, getByteTimeDomainData: (a: Uint8Array) => a.fill(250) } as unknown as AnalyserNode;
    const { container, rerender } = render(<LevelBars analyser={analyser} />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    const bars = Array.from(container.querySelectorAll<HTMLElement>(".ds-bars > span"));
    expect(bars.every((b) => b.style.height !== "")).toBe(true);
    expect(container.firstElementChild).toHaveAttribute("data-follows", "sound");
    rerender(<LevelBars analyser={null} />);
    expect(container.firstElementChild).toHaveAttribute("data-follows", "style");
    expect(bars.every((b) => b.style.height === "")).toBe(true);
  });
});
