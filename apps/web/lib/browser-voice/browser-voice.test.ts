import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceClient, SPEECH_FRAMES, SPEECH_LEVEL, type AudioIO, type SocketLike } from "./client";
import { fromPcm16, level, toPcm16At16k } from "./pcm";
import { endWordOf, parseServerMessage, setLanguageMessage, startMessage, voiceSocketUrl } from "./protocol";

const json = (o: unknown): string => JSON.stringify(o);

describe("the sound", () => {
  it("a frame at 48 kHz becomes 16 kHz PCM16 little-endian (a third of the samples), clipped to the range", () => {
    const input = new Float32Array(480).fill(0.5);
    input[0] = 2; // clipped
    const out = new DataView(toPcm16At16k(input, 48_000));
    expect(out.byteLength).toBe(160 * 2);
    expect(out.getInt16(0, true)).toBeGreaterThan(0x3000); // (2 clipped to 1, + 0.5 + 0.5) / 3 ~ 0.67
    expect(out.getInt16(2, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(toPcm16At16k(new Float32Array(0), 48_000).byteLength).toBe(0);
  });
  it("the assistant's voice (PCM16 LE) comes back to floats; an odd trailing byte is dropped; loudness is the RMS", () => {
    const bytes = new DataView(new ArrayBuffer(5));
    bytes.setInt16(0, 0x4000, true);
    bytes.setInt16(2, -0x8000, true);
    const f = fromPcm16(bytes.buffer);
    expect(Array.from(f)).toEqual([0.5, -1]);
    expect(level(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(level(new Float32Array(0))).toBe(0);
  });
});

describe("the messages", () => {
  it("the first message carries the sign-in and the language; the address of the socket is made from the API's own address", () => {
    expect(JSON.parse(startMessage("tok", "te"))).toEqual({ type: "start", access_token: "tok", language: "te" });
    expect(JSON.parse(setLanguageMessage("hi"))).toEqual({ type: "set_language", language: "hi" });
    expect(voiceSocketUrl("https://sme-api-1.run.app/", "t-1")).toBe("wss://sme-api-1.run.app/v1/tenants/t-1/voice-chat");
    expect(voiceSocketUrl("http://localhost:8000", "t")).toBe("ws://localhost:8000/v1/tenants/t/voice-chat");
    expect(voiceSocketUrl("javascript:1", "t")).toBeNull();
  });
  it("reads each message of the API and nothing else", () => {
    expect(parseServerMessage(json({ type: "ready", session_id: "s1", language: "te", limits: { session_seconds: 300, day_seconds_left: 1700 } }))).toEqual({ type: "ready", sessionId: "s1", language: "te", sessionSeconds: 300, daySecondsLeft: 1700 });
    expect(parseServerMessage(json({ type: "state", state: "thinking", step: "looking" }))).toEqual({ type: "state", state: "thinking", step: "looking" });
    expect(parseServerMessage(json({ type: "caption", who: "assistant", text: "Long answer", final: true, spoken: false }))).toEqual({ type: "caption", who: "assistant", text: "Long answer", final: true, spoken: false });
    expect(parseServerMessage(json({ type: "source", kind: "price_item", label: "Silk saree" }))).toEqual({ type: "source", kind: "price_item", label: "Silk saree" });
    expect(parseServerMessage(json({ type: "limit", reason: "daily_limit", fatal: true }))).toEqual({ type: "limit", reason: "daily_limit" });
    expect(parseServerMessage(json({ type: "error", code: "budget", message: "Used up for today", fatal: false }))).toMatchObject({ code: "budget", fatal: false });
    for (const bad of ["not json", json({ type: "state", state: "dancing" }), json({ type: "caption", who: "robot", text: "x" }), json({ type: "ready", language: "xx", session_id: "s" }), json({ nothing: 1 }), json("x"), 5, null, "x".repeat(30_000)]) expect(parseServerMessage(bad)).toBeNull();
  });
  it("every end has plain words: a limit, a refusal code, the close code", () => {
    expect(endWordOf(null, { limit: "session" })).toBe("session");
    expect(endWordOf({ code: 4429 }, { errorCode: "busy" })).toBe("busy");
    expect(endWordOf({ code: 4429 }, { errorCode: "rate_limited" })).toBe("rate");
    expect(endWordOf({ code: 4429 }, { errorCode: "daily_limit" })).toBe("daily");
    expect(endWordOf({ code: 4401 })).toBe("signin");
    expect(endWordOf({ code: 4403 })).toBe("refused");
    expect(endWordOf({ code: 4404 })).toBe("gone");
    expect(endWordOf({ code: 4503 })).toBe("unavailable");
    expect(endWordOf({ code: 1000 })).toBe("left");
    expect(endWordOf({ code: 1006 })).toBe("unavailable");
  });
});

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
    this.onmessage?.({ data: typeof m === "string" || m instanceof ArrayBuffer ? m : json(m) });
  }
  types() {
    return this.sent.map((s) => (typeof s === "string" ? (JSON.parse(s) as { type: string }).type : "audio"));
  }
}
function fakeAudio() {
  let frame: ((pcm: ArrayBuffer, level: number) => void) | null = null;
  const calls = { played: 0, flushed: 0, closed: 0, micStopped: 0 };
  const io: AudioIO = {
    startMic: async (cb) => void (frame = cb),
    stopMic: () => void calls.micStopped++,
    play: () => void calls.played++,
    flush: () => void calls.flushed++,
    playing: () => false,
    close: () => void calls.closed++,
    analyser: () => null,
  };
  return { io, calls, frame: (level: number) => frame?.(new ArrayBuffer(640), level) };
}

describe("a session", () => {
  let ws: FakeSocket;
  let audio: ReturnType<typeof fakeAudio>;
  let client: VoiceClient;
  let changes: number;
  beforeEach(() => {
    vi.useFakeTimers();
    ws = new FakeSocket();
    audio = fakeAudio();
    changes = 0;
    client = new VoiceClient({ url: "wss://x/v1/tenants/t/voice-chat", token: "tok", language: "te", audio: audio.io, socket: () => ws, onChange: () => void changes++ });
  });
  afterEach(() => vi.useRealTimers());
  const ready = async () => {
    await client.start();
    ws.open();
    ws.say({ type: "ready", session_id: "s", language: "te", limits: {} });
  };

  it("opens the microphone, sends the sign-in first, and says ready", async () => {
    await ready();
    expect(ws.binaryType).toBe("arraybuffer");
    expect(ws.types()[0]).toBe("start");
    expect(client.snapshot.phase).toBe("ready");
  });
  it("a refused microphone ends it at once, with no socket", async () => {
    audio.io.startMic = async () => {
      throw new Error("denied");
    };
    await client.start();
    expect(client.snapshot).toMatchObject({ phase: "ended", micDenied: true, end: "refused" });
    expect(ws.sent).toEqual([]);
  });
  it("sends the microphone only while the assistant listens", async () => {
    await ready();
    audio.frame(0.01);
    expect(ws.types()).toEqual(["start"]); // nothing yet: no listening state
    ws.say({ type: "state", state: "listening" });
    audio.frame(0.01);
    ws.say({ type: "state", state: "thinking" });
    audio.frame(0.01);
    expect(ws.types()).toEqual(["start", "audio"]);
  });
  it("the thinking state says when it is looking at the records; the voice is played as it arrives, not while it listens", async () => {
    await ready();
    ws.say({ type: "state", state: "thinking", step: "looking" });
    expect(client.snapshot).toMatchObject({ state: "thinking", step: "looking" });
    ws.say({ type: "state", state: "speaking" });
    ws.say(new ArrayBuffer(4800));
    expect(audio.calls.played).toBe(1);
    ws.say({ type: "state", state: "listening" });
    ws.say(new ArrayBuffer(4800)); // a late chunk after the turn: not played
    expect(audio.calls.played).toBe(1);
  });
  it("barge-in: speaking over the assistant (a few loud frames in a row) stops the sound HERE, then tells the API, and goes on sending the microphone", async () => {
    await ready();
    ws.say({ type: "state", state: "speaking" });
    for (let i = 0; i < SPEECH_FRAMES - 1; i++) audio.frame(SPEECH_LEVEL + 0.1);
    expect(ws.types()).toEqual(["start"]); // not yet
    audio.frame(0.0); // a pause resets the count
    for (let i = 0; i < SPEECH_FRAMES; i++) audio.frame(SPEECH_LEVEL + 0.1);
    expect(audio.calls.flushed).toBe(1);
    expect(ws.types().slice(1)).toEqual(["barge_in", "audio"]);
    expect(client.snapshot.state).toBe("listening");
  });
  it("audio_stop flushes the playback queue at once", async () => {
    await ready();
    ws.say({ type: "audio_stop" });
    expect(audio.calls.flushed).toBe(1);
  });
  it("captions: a partial is replaced by the next, a final stays; the part of a long answer that is not read aloud is marked; sources are listed once", async () => {
    await ready();
    ws.say({ type: "caption", who: "user", text: "pri", final: false, spoken: true });
    ws.say({ type: "caption", who: "user", text: "price of a saree", final: true, spoken: true });
    ws.say({ type: "caption", who: "assistant", text: "It is 500 rupees.", final: true, spoken: true });
    ws.say({ type: "caption", who: "assistant", text: "More details here.", final: true, spoken: false });
    ws.say({ type: "source", kind: "price_item", label: "Silk saree" });
    ws.say({ type: "source", kind: "price_item", label: "Silk saree" });
    expect(client.snapshot.captions.map((c) => [c.who, c.text, c.spoken])).toEqual([["user", "price of a saree", true], ["assistant", "It is 500 rupees.", true], ["assistant", "More details here.", false]]);
    expect(client.snapshot.sources).toEqual([{ kind: "price_item", label: "Silk saree" }]);
  });
  it("a limit or a close ends it with plain words and lets everything go; a second tap stops it", async () => {
    await ready();
    ws.say({ type: "limit", reason: "idle" });
    ws.onclose?.({ code: 1000, reason: "" });
    expect(client.snapshot).toMatchObject({ phase: "ended", end: "idle" });
    expect(audio.calls.closed).toBe(1);
    expect(audio.calls.micStopped).toBe(1);
  });
  it("stop tells the API and ends; set_language is sent and shown", async () => {
    await ready();
    client.setLanguage("hi");
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: "set_language", language: "hi" });
    client.stop();
    expect(ws.types().at(-1)).toBe("stop");
    expect(client.snapshot).toMatchObject({ phase: "ended", end: "left" });
    client.stop(); // twice does nothing more
    expect(audio.calls.closed).toBe(1);
  });
  it("a close with the code 4429 says busy; a message that is not the API's is ignored", async () => {
    await ready();
    ws.say("garbage");
    ws.onclose?.({ code: 4429, reason: "busy" });
    expect(client.snapshot.end).toBe("busy");
  });
});
