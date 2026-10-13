import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";

import { AskTeam } from "./AskTeam";
import { ASK_WORD_KEYS } from "./ask-words";
import type { AskEvent, AskTransport, VoiceRequest, VoiceStatus, VoiceTransport } from "./ask-types";

const en = appT("en");
const WORDS = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const B = "/app/tenants/T";
const ON: VoiceStatus = { available: true, speech: true };
const typed: AskTransport = async function* () {
  yield { type: "done" };
};

/** A recorder, a microphone and a speaker that need no hardware. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported = (m: string) => FakeRecorder.supported.includes(m);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  opts: { mimeType: string; audioBitsPerSecond: number };
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_s: unknown, opts: { mimeType: string; audioBitsPerSecond: number }) {
    this.opts = opts;
    this.mimeType = opts.mimeType;
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice-bytes"], { type: this.mimeType }) });
    this.onstop?.(new Event("stop"));
  }
}
class FakeAudio {
  static last: FakeAudio | null = null;
  static blocked = false;
  listeners = new Map<string, (() => void)[]>();
  currentTime = 0;
  constructor(readonly src: string) {
    FakeAudio.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  play = vi.fn(async () => {
    if (FakeAudio.blocked) throw new DOMException("blocked", "NotAllowedError");
  });
  pause = vi.fn(() => this.fire("pause"));
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;
function mic(impl?: () => Promise<unknown>) {
  track = { stop: vi.fn() };
  getUserMedia = vi.fn(impl ?? (async () => ({ getTracks: () => [track] })));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}
const phone = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("767"), media: q, addEventListener() {}, removeEventListener() {} }));

/** A voice transport that plays the given events and records what it was asked. */
function voicePlaying(events: AskEvent[], seen: VoiceRequest[] = []): VoiceTransport {
  return async function* (req) {
    seen.push(req);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  };
}
const ANSWER: AskEvent[] = [{ type: "heard", text: "What needs me today?" }, { type: "text", delta: "Two quotes wait." }, { type: "done" }];
const WAV = { type: "audio", contentType: "audio/wav", data: "UklGRg==" } as const;

function box(opts: { status?: VoiceStatus | null; voice?: VoiceTransport | null; lang?: string; variant?: "box" | "hero" } = {}) {
  return render(<AskTeam variant={opts.variant} lang={opts.lang ?? "en"} base={B} words={WORDS} availability="live" transport={typed} voiceStatus={opts.status === undefined ? ON : opts.status} voiceTransport={opts.voice === undefined ? voicePlaying(ANSWER) : opts.voice} />);
}
const micButton = () => screen.getByRole("button", { name: "Speak your question" });
const owlOf = () => document.querySelector(".plush")!.getAttribute("data-mood");
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
/** Taps the microphone and lets the browser "give" it. */
async function startRecording() {
  await act(async () => void fireEvent.click(micButton()));
  await screen.findByText("Recording…");
}
async function stopRecording() {
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop and ask" })));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeRecorder.last = null;
  FakeRecorder.supported = ["audio/webm;codecs=opus"];
  FakeAudio.last = null;
  FakeAudio.blocked = false;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:answer");
  URL.revokeObjectURL = vi.fn();
  phone(false);
  mic();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the microphone is shown only when voice is on", () => {
  it.each([
    ["the API says voice is off", { status: { available: false, speech: false } }],
    ["the answer is not known yet", { status: null }],
    ["there is no recording transport", { voice: null }],
  ])("%s: no microphone, no switch, no privacy line", (_n, opts) => {
    box(opts as never);
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/sent to our speech service/)).toBeNull();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
  it("a browser that cannot record has no microphone", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    box();
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
  });
  it("a browser with no type the API reads has no microphone", () => {
    FakeRecorder.supported = ["video/webm"];
    box();
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
  });
  it("a browser with no microphone API has no microphone", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    box();
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
  });
  it("is shown when voice is on: 48 px, named, not pressed", () => {
    box();
    const b = micButton();
    expect(b).toHaveAttribute("aria-pressed", "false");
    expect(b.className).toContain("size-12");
  });
  it("asks the workspace's own voice route when it is not told (and the answer decides)", async () => {
    vi.useRealTimers();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ available: true, speech: false }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<AskTeam lang="en" base={B} words={WORDS} availability="live" transport={typed} />);
    await screen.findByRole("button", { name: "Speak your question" });
    expect(fetcher).toHaveBeenCalledWith(`${B}/ask/voice`, expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("switch")).toBeNull(); // it hears but cannot speak: no auto-play switch
  });
  it("a failed status request leaves no microphone", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    render(<AskTeam lang="en" base={B} words={WORDS} availability="live" transport={typed} />);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
  });
});

describe("the privacy line", () => {
  it("is shown under the microphone before the first use, in English, exactly", () => {
    box();
    expect(screen.getByText(/Your voice is sent to our speech service to be understood\. We don't keep the recording\./)).toBeInTheDocument();
  });
  it("goes after the first recording is sent, and stays gone", async () => {
    box();
    await startRecording();
    await tick(1000);
    await stopRecording();
    await screen.findByText("Two quotes wait.");
    expect(screen.queryByText(/sent to our speech service/)).toBeNull();
    cleanup();
    box();
    expect(screen.queryByText(/sent to our speech service/)).toBeNull();
  });
  it("is still there after a recording that was cancelled", async () => {
    box();
    await startRecording();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/sent to our speech service/)).toBeInTheDocument();
  });
});

describe("record, stop, cancel", () => {
  it("tap to start: the browser is asked for a mono microphone, the recorder gets a small bit rate, and the box shows the countdown and a Cancel", async () => {
    box();
    await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ channelCount: 1 }) });
    expect(FakeRecorder.last!.opts).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
    expect(screen.getByText("1:00 left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop and ask" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });
  it("the microphone button stays the same element, before Cancel: nothing moves under the finger that started the recording (the tap's click must not land on Cancel)", async () => {
    box();
    const before = micButton();
    await startRecording();
    const during = screen.getByRole("button", { name: "Stop and ask" });
    expect(during).toBe(before);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(during.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("counts down on the screen and says the seconds to a screen reader near the end", async () => {
    box();
    await startRecording();
    await tick(18_000);
    expect(screen.getByText("0:42 left")).toBeInTheDocument();
    await tick(36_000);
    expect(screen.getByText("0:06 left")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recording. 10 seconds left.");
  });
  it("stops by itself at 60 seconds and sends what it has", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await startRecording();
    await tick(60_500);
    await screen.findByText("Two quotes wait.");
    expect(seen).toHaveLength(1);
    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByText(/left$/)).toBeNull();
  });
  it("tap to stop: the recording is sent with the language of the chip, and the microphone is let go", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen), lang: "te" });
    await startRecording();
    await tick(2000);
    await stopRecording();
    await screen.findByText("Two quotes wait.");
    expect(seen).toHaveLength(1);
    expect(seen[0].lang).toBe("te");
    expect(seen[0].audio).toBeInstanceOf(Blob);
    expect(seen[0].audio.type).toBe("audio/webm;codecs=opus");
    expect(seen[0].audio.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();
  });
  it("shows what it heard as the person's own message, then the written answer", async () => {
    box();
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByText("You said: What needs me today?")).toBeInTheDocument();
    expect(screen.getByText("Two quotes wait.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("says it is understanding the voice until the words arrive", async () => {
    const gate: { open?: () => void } = {};
    const slow: VoiceTransport = async function* () {
      await new Promise<void>((r) => (gate.open = r));
      yield { type: "heard", text: "Hello" };
      yield { type: "done" };
    };
    box({ voice: slow });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByText("Understanding your voice…")).toBeInTheDocument();
    await act(async () => gate.open?.());
    expect(await screen.findByText("You said: Hello")).toBeInTheDocument();
  });
  it("Cancel throws the recording away: nothing is sent, the microphone is let go, and the box is as before", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await startRecording();
    await tick(3000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await tick(70_000);
    expect(seen).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("Recording…")).toBeNull();
    expect(micButton()).toHaveAttribute("aria-pressed", "false");
  });
  it("Escape cancels", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await startRecording();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });
  it("a touch that is too short to be a question is not sent", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await startRecording();
    await tick(200);
    await stopRecording();
    expect(await screen.findByRole("status")).toHaveTextContent("That was too short. Try again, or type your question.");
    expect(seen).toHaveLength(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
  it("leaving the page while recording lets the microphone go", async () => {
    const { unmount } = box();
    await startRecording();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });
  it("the microphone can be used again after an answer", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    for (let i = 0; i < 2; i++) {
      await startRecording();
      await tick(1500);
      await stopRecording();
      await screen.findByText("Two quotes wait.");
    }
    expect(seen).toHaveLength(2);
  });
  it("a new recording ends an answer that is still coming", async () => {
    const aborted: boolean[] = [];
    const never: VoiceTransport = async function* ({ signal }) {
      await new Promise<void>((r) => signal.addEventListener("abort", () => (aborted.push(true), r())));
    };
    box({ voice: never });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByText("Understanding your voice…");
    await startRecording();
    expect(aborted).toEqual([true]);
  });
});

describe("hold to talk (a finger)", () => {
  const touch = (el: Element, type: "pointerDown" | "pointerUp") => fireEvent[type](el, { pointerType: "touch", pointerId: 1 });
  it("holding records, and letting go sends", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await act(async () => void touch(micButton(), "pointerDown"));
    await screen.findByText("Recording…");
    await tick(1200);
    await act(async () => void touch(screen.getByRole("button", { name: "Stop and ask" }), "pointerUp"));
    await screen.findByText("Two quotes wait.");
    expect(seen).toHaveLength(1);
  });
  it("a quick tap starts it and goes on recording; the next tap stops it", async () => {
    const seen: VoiceRequest[] = [];
    box({ voice: voicePlaying(ANSWER, seen) });
    await act(async () => void touch(micButton(), "pointerDown"));
    await screen.findByText("Recording…");
    await tick(100);
    await act(async () => void touch(screen.getByRole("button", { name: "Stop and ask" }), "pointerUp"));
    expect(screen.getByText("Recording…")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
    await tick(1500);
    await act(async () => void touch(screen.getByRole("button", { name: "Stop and ask" }), "pointerDown"));
    await screen.findByText("Two quotes wait.");
    expect(seen).toHaveLength(1);
  });
  it("the tap that the touch already handled is not handled again by the click that follows", async () => {
    box();
    await act(async () => void touch(micButton(), "pointerDown"));
    await screen.findByText("Recording…");
    await tick(100);
    await act(async () => void touch(screen.getByRole("button", { name: "Stop and ask" }), "pointerUp"));
    fireEvent.click(screen.getByRole("button", { name: "Stop and ask" })); // the click a browser sends after the touch
    expect(screen.getByText("Recording…")).toBeInTheDocument();
  });
  it("the first time, while the browser asks for the microphone, letting go does not end the recording that starts after", async () => {
    let allow!: () => void;
    mic(() => new Promise((r) => (allow = () => r({ getTracks: () => [track] }))));
    box();
    await act(async () => void touch(micButton(), "pointerDown"));
    expect(screen.getByText("Starting the microphone…")).toBeInTheDocument();
    await tick(3000); // the person reads the permission prompt
    await act(async () => void touch(screen.getByRole("button", { name: "Stop and ask" }), "pointerUp"));
    await act(async () => allow());
    await screen.findByText("Recording…");
    expect(screen.getByText("1:00 left")).toBeInTheDocument();
  });
  it("the button does not scroll or select under a finger, and has no long-press menu", () => {
    box();
    expect(micButton().className).toMatch(/touch-none/);
    expect(micButton().className).toMatch(/select-none/);
    expect(fireEvent.contextMenu(micButton())).toBe(false);
  });
});

describe("what goes wrong, in words", () => {
  const failing = (name: string) => mic(async () => Promise.reject(new DOMException("x", name)));
  it("the microphone was refused", async () => {
    failing("NotAllowedError");
    box();
    await act(async () => void fireEvent.click(micButton()));
    expect(await screen.findByRole("status")).toHaveTextContent("The microphone is not allowed. Type your question instead.");
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
  it("there is no microphone", async () => {
    failing("NotFoundError");
    box();
    await act(async () => void fireEvent.click(micButton()));
    expect(await screen.findByRole("status")).toHaveTextContent("No microphone was found. Type your question instead.");
  });
  it("anything else that stops the microphone", async () => {
    failing("AbortError");
    box();
    await act(async () => void fireEvent.click(micButton()));
    expect(await screen.findByRole("status")).toHaveTextContent("Could not listen. Type your question instead.");
  });
  it.each([
    ["the allowance is used up", "ai_paused_until", "Today's AI spending limit has been reached. Try again tomorrow."],
    ["the recording is too long", "voice_too_long", "That recording is too long. Keep it under a minute."],
    ["the recording is too short", "voice_too_short", "That was too short. Try again, or type your question."],
    ["nothing could be heard", "voice_no_speech", "Nothing was heard. Try again, or type your question."],
    ["the speech service failed", "voice_failed", "Your voice could not be understood just now. Try again, or type your question."],
    ["there is no connection", "network", "No connection. Check your internet and try again."],
    ["the role may not", "forbidden", "Your role cannot ask the team."],
  ])("%s", async (_n, code, words) => {
    box({ voice: voicePlaying([{ type: "error", code }]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByRole("alert")).toHaveTextContent(words.slice(0, 20));
    expect(screen.getByRole("alert").textContent).toContain(words);
    expect(screen.getByRole("textbox")).toBeEnabled(); // typing still works
  });
  it("voice switched off since the page loaded: the message, and the microphone goes away", async () => {
    box({ voice: voicePlaying([{ type: "error", code: "voice_unavailable" }]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice is not switched on right now. Type your question instead.");
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
  });
  it("a broken answer says the general sentence", async () => {
    box({ voice: voicePlaying([{ type: "error" }]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByRole("alert")).toHaveTextContent("The answer could not be completed. Nothing was changed.");
  });
});

describe("Agent OWL's mood", () => {
  it("listens while recording, thinks while the recording is understood, answers while it streams, and is idle when done", async () => {
    const hold: { first?: () => void; second?: () => void } = {};
    const slow: VoiceTransport = async function* () {
      await new Promise<void>((r) => (hold.first = r));
      yield { type: "heard", text: "Hi" };
      yield { type: "text", delta: "Two quotes wait." };
      await new Promise<void>((r) => (hold.second = r));
      yield { type: "done" };
    };
    box({ voice: slow });
    expect(owlOf()).toBe("idle");
    await startRecording();
    expect(owlOf()).toBe("listening");
    await tick(1500);
    await stopRecording();
    await waitFor(() => expect(owlOf()).toBe("thinking"));
    await act(async () => hold.first?.());
    await waitFor(() => expect(owlOf()).toBe("answering"));
    await act(async () => hold.second?.());
    await waitFor(() => expect(owlOf()).toBe("idle"));
  });
  it("tells the card (the hero) the same moods", async () => {
    const onMood = vi.fn();
    render(<AskTeam variant="hero" lang="en" base={B} words={WORDS} availability="live" transport={typed} voiceStatus={ON} voiceTransport={voicePlaying(ANSWER)} onMood={onMood} />);
    await startRecording();
    expect(onMood).toHaveBeenLastCalledWith("listening");
    await tick(1500);
    await stopRecording();
    await waitFor(() => expect(onMood).toHaveBeenCalledWith("thinking"));
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith("idle"));
  });
  it("answers while the spoken answer plays", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByRole("button", { name: "Stop" });
    expect(owlOf()).toBe("answering");
    act(() => FakeAudio.last!.fire("ended"));
    await waitFor(() => expect(owlOf()).toBe("idle"));
  });
});

describe("the spoken answer and the auto-play setting", () => {
  const speakFlags = async (setup: () => void, status: VoiceStatus = ON) => {
    const seen: VoiceRequest[] = [];
    setup();
    box({ voice: voicePlaying(ANSWER, seen), status });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByText("Two quotes wait.");
    return seen[0].speak;
  };
  it("defaults to on for a phone and off for a laptop", async () => {
    phone(true);
    box();
    expect(screen.getByRole("switch", { name: "Play voice answers automatically" })).toHaveAttribute("aria-checked", "true");
    cleanup();
    phone(false);
    box();
    expect(screen.getByRole("switch", { name: "Play voice answers automatically" })).toHaveAttribute("aria-checked", "false");
  });
  it("a saved choice wins over the default, and the switch saves the choice", () => {
    phone(true);
    window.localStorage.setItem("sme-ask-autoplay", "0");
    box();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("sme-ask-autoplay")).toBe("1");
    fireEvent.click(sw);
    expect(window.localStorage.getItem("sme-ask-autoplay")).toBe("0");
  });
  it("the switch is a 44 px target", () => {
    box();
    expect(screen.getByRole("switch").className).toContain("min-h-11");
  });
  it("a spoken answer is asked for only when auto-play is on and the API can speak", async () => {
    expect(await speakFlags(() => window.localStorage.setItem("sme-ask-autoplay", "1"))).toBe(true);
    cleanup();
    expect(await speakFlags(() => window.localStorage.setItem("sme-ask-autoplay", "0"))).toBe(false);
    cleanup();
    expect(await speakFlags(() => window.localStorage.setItem("sme-ask-autoplay", "1"), { available: true, speech: false })).toBe(false);
  });
  it("a browser with blocked storage still works (the choice lasts until the page closes)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    box();
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    vi.restoreAllMocks();
  });
  it("plays the spoken answer by itself when auto-play is on, from a blob address, and offers Stop", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(FakeAudio.last!.src).toBe("blob:answer");
    expect(FakeAudio.last!.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop" })).toBe(stop);
    fireEvent.click(stop);
    expect(FakeAudio.last!.pause).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Play spoken answer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play spoken answer" }));
    await waitFor(() => expect(FakeAudio.last!.play).toHaveBeenCalledTimes(2));
  });
  it("when the browser will not start sound by itself, the Play button is there", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    FakeAudio.blocked = true;
    box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByRole("button", { name: "Play spoken answer" })).toBeInTheDocument();
    expect(owlOf()).toBe("idle");
  });
  it("says the spoken answer is being made while it is not here yet, and that it could not be made if it fails; the written answer stands", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    const gate: { open?: () => void } = {};
    const slow: VoiceTransport = async function* () {
      yield* ANSWER;
      await new Promise<void>((r) => (gate.open = r));
      yield { type: "audio_error", code: "voice_failed" };
    };
    box({ voice: slow });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByText("Preparing the spoken answer…")).toBeInTheDocument();
    expect(screen.getByText("Two quotes wait.")).toBeInTheDocument();
    await act(async () => gate.open?.());
    expect(await screen.findByText("The spoken answer could not be made. The written answer above is complete.")).toBeInTheDocument();
    expect(screen.queryByText("Preparing the spoken answer…")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("audio that cannot be decoded is said as a spoken-answer failure, not a crash", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    box({ voice: voicePlaying([...ANSWER, { type: "audio", contentType: "audio/wav", data: "!!!not base64!!!" }]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    expect(await screen.findByText("The spoken answer could not be made. The written answer above is complete.")).toBeInTheDocument();
  });
  it("a new question stops and lets go of the old spoken answer", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByRole("button", { name: "Stop" });
    const first = FakeAudio.last!;
    fireEvent.click(screen.getByRole("button", { name: "What needs me today?" }));
    await waitFor(() => expect(first.pause).toHaveBeenCalled());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:answer");
    expect(screen.queryByRole("button", { name: "Play spoken answer" })).toBeNull();
  });
  it("turning auto-play off stops what is playing", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(screen.getByRole("switch"));
    expect(FakeAudio.last!.pause).toHaveBeenCalled();
  });
  it("leaving the page lets go of the sound", async () => {
    window.localStorage.setItem("sme-ask-autoplay", "1");
    const { unmount } = box({ voice: voicePlaying([...ANSWER, WAV]) });
    await startRecording();
    await tick(1500);
    await stopRecording();
    await screen.findByRole("button", { name: "Stop" });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:answer");
  });
});

describe("the same on the hero (phone question bar) and in four languages", () => {
  it("the hero's microphone and Cancel are round 48 px targets (56 on a laptop)", async () => {
    box({ variant: "hero" });
    expect(micButton().className).toMatch(/size-12/);
    expect(micButton().className).toMatch(/md:size-14/);
    await startRecording();
    expect(screen.getByRole("button", { name: "Cancel" }).className).toMatch(/size-12/);
    expect(screen.getByRole("button", { name: "Stop and ask" }).className).toMatch(/size-12/);
  });
  it.each(["te", "hi", "kn"])("%s: every voice word is in the language and none is a bare key", async (lang) => {
    const t = appT(lang as "te");
    const words = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k as "frame.notyet")]));
    render(<AskTeam lang={lang} base={B} words={words} availability="live" transport={typed} voiceStatus={ON} voiceTransport={voicePlaying(ANSWER)} />);
    const b = screen.getByRole("button", { name: words["ask.mic"] });
    expect(words["ask.mic"]).not.toBe("Speak your question");
    await act(async () => void fireEvent.click(b));
    await screen.findByText(words["ask.listening"]);
    expect(screen.getByText(words["ask.voice.left"].replace("{time}", "1:00"))).toBeInTheDocument();
    expect(within(document.body).getByRole("button", { name: words["ask.voice.cancel"] })).toBeInTheDocument();
    for (const k of ASK_WORD_KEYS) expect(words[k], k).not.toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });
  it("the privacy line stays in English in every language", () => {
    const t = appT("hi");
    const words = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k as "frame.notyet")]));
    render(<AskTeam lang="hi" base={B} words={words} availability="live" transport={typed} voiceStatus={ON} voiceTransport={voicePlaying(ANSWER)} />);
    expect(screen.getByText(/Your voice is sent to our speech service to be understood\. We don't keep the recording\./)).toBeInTheDocument();
  });
});
