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
    const C = "55555555-5555-4555-8555-555555555555";
    expect(JSON.parse(startMessage("tok", "te", { mode: "dictate" }))).toEqual({ type: "start", access_token: "tok", language: "te", mode: "dictate" });
    expect(JSON.parse(startMessage("tok", "te", { mode: "dictate", sttLanguage: "te" }))).toEqual({ type: "start", access_token: "tok", language: "te", mode: "dictate", stt_language: "te" });
    expect(JSON.parse(startMessage("tok", "en", { mode: "dictate", sttLanguage: null }))).not.toHaveProperty("stt_language");
    expect(JSON.parse(startMessage("tok", "te", { conversationId: C }))).toEqual({ type: "start", access_token: "tok", language: "te", conversation_id: C });
    expect(JSON.parse(startMessage("tok", "te", { conversationId: "not-an-id" }))).toEqual({ type: "start", access_token: "tok", language: "te" }); // a bad id is never sent
    expect(parseServerMessage(json({ type: "ready", session_id: "s", language: "en", limits: {}, conversation_id: C }))).toMatchObject({ conversationId: C });
    expect(JSON.parse(setLanguageMessage("hi"))).toEqual({ type: "set_language", language: "hi" });
    expect(voiceSocketUrl("https://sme-api-1.run.app/", "t-1")).toBe("wss://sme-api-1.run.app/v1/tenants/t-1/voice-chat");
    expect(voiceSocketUrl("http://localhost:8000", "t")).toBe("ws://localhost:8000/v1/tenants/t/voice-chat");
    expect(voiceSocketUrl("javascript:1", "t")).toBeNull();
  });
  it("reads each message of the API and nothing else", () => {
    expect(parseServerMessage(json({ type: "ready", session_id: "s1", language: "te", limits: { session_seconds: 300, day_seconds_left: 1700 } }))).toEqual({ type: "ready", sessionId: "s1", language: "te", sessionSeconds: 300, daySecondsLeft: 1700, conversationId: null });
    expect(parseServerMessage(json({ type: "state", state: "thinking", step: "looking" }))).toEqual({ type: "state", state: "thinking", step: "looking" });
    expect(parseServerMessage(json({ type: "caption", who: "assistant", text: "Long answer", final: true, spoken: false }))).toEqual({ type: "caption", who: "assistant", text: "Long answer", final: true, spoken: false });
    expect(parseServerMessage(json({ type: "source", kind: "price_item", label: "Silk saree" }))).toEqual({ type: "source", kind: "price_item", label: "Silk saree" });
    expect(parseServerMessage(json({ type: "limit", reason: "daily_limit", fatal: true }))).toEqual({ type: "limit", reason: "daily_limit" });
    expect(parseServerMessage(json({ type: "error", code: "budget", message: "Used up for today", fatal: false }))).toMatchObject({ code: "budget", fatal: false });
    for (const bad of ["not json", json({ type: "state", state: "dancing" }), json({ type: "caption", who: "robot", text: "x" }), json({ type: "ready", language: "xx", session_id: "s" }), json({ nothing: 1 }), json("x"), 5, null, "x".repeat(30_000)]) expect(parseServerMessage(bad)).toBeNull();
  });
  it("a whole written answer (Markdown, newlines, thousands of characters) is a caption; one past the limit is not", () => {
    const long = "- item\n".repeat(1200);
    expect(parseServerMessage(json({ type: "caption", who: "assistant", text: long, final: true, spoken: true, spoken_text: "Short." }))).toMatchObject({ type: "caption", text: long });
    expect(parseServerMessage(json({ type: "caption", who: "assistant", text: "x".repeat(12_001), final: true }))).toBeNull();
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

  it("dictation keeps the first words spoken while the socket opens and sends them once the API is ready (the start of the sentence is not lost); a live session does not", async () => {
    const dict = new VoiceClient({ url: "wss://x/v1/tenants/t/voice-chat", token: "tok", language: "te", audio: audio.io, socket: () => ws, onChange: () => undefined, mode: "dictate" });
    await dict.start();
    audio.frame(0.5);
    audio.frame(0.5);
    ws.open();
    expect(ws.types()).toEqual(["start"]); // not ready yet: nothing but the start
    ws.say({ type: "ready", session_id: "s", language: "te", limits: {}, mode: "dictate" });
    expect(ws.types()).toEqual(["start", "audio", "audio"]); // the two early frames, in order, then live ones
    audio.frame(0.5);
    expect(ws.types().length).toBe(4);
  });
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
  it("transcripts: the person's words show live, replaced by newer ones and by the settled words; the older final caption that repeats them is not a second line", async () => {
    await ready();
    ws.say({ type: "transcript", text: "how many", final: false, seq: 1, t_ms: 250 });
    ws.say({ type: "transcript", text: "how many enquiries", final: false, seq: 2, t_ms: 500 });
    expect(client.snapshot.captions).toMatchObject([{ who: "user", text: "how many enquiries", final: false }]);
    ws.say({ type: "transcript", text: "How many enquiries today?", final: true, seq: 3, t_ms: 900 });
    ws.say({ type: "caption", who: "user", text: "How many enquiries today?", final: true, spoken: true });
    ws.say({ type: "caption", who: "assistant", text: "Four.", final: true, spoken: true });
    expect(client.snapshot.captions.map((c) => [c.who, c.text, c.final])).toEqual([["user", "How many enquiries today?", true], ["assistant", "Four.", true]]);
  });
  it("the person's words are ONE line whichever message comes first (the server sends the caption, then the transcript): interim and final never make two lines; a new utterance after an answer is a new line", async () => {
    await ready();
    for (const [text, final] of [["how", false], ["how many", false], ["How many enquiries?", true]] as const) {
      ws.say({ type: "caption", who: "user", text, final, spoken: true });
      ws.say({ type: "transcript", text, final, seq: 1, t_ms: 1 });
    }
    ws.say({ type: "caption", who: "assistant", text: "Four.", final: true, spoken: true });
    ws.say({ type: "caption", who: "user", text: "and", final: false, spoken: true });
    ws.say({ type: "transcript", text: "and who?", final: true, seq: 1, t_ms: 1 });
    ws.say({ type: "caption", who: "user", text: "and who?", final: true, spoken: true });
    expect(client.snapshot.captions.map((c) => [c.who, c.text, c.final])).toEqual([["user", "How many enquiries?", true], ["assistant", "Four.", true], ["user", "and who?", true]]);
  });
  it("the assistant's pieces (a few letters each, final each) are ONE text joined as they are, Telugu letters never cut apart; the part not read aloud stays a second text", async () => {
    await ready();
    const pieces = ["Great, th", "anks for pic", "king up. ", "నమ", "స్కా", "రం! ", "ఇ", "ది"];
    for (const text of pieces) ws.say({ type: "caption", who: "assistant", text, final: true, spoken: true });
    ws.say({ type: "caption", who: "assistant", text: "More.", final: true, spoken: false });
    expect(client.snapshot.captions.map((c) => [c.text, c.spoken])).toEqual([[pieces.join(""), true], ["More.", false]]);
    expect(client.snapshot.captions[0].text).toBe("Great, thanks for picking up. నమస్కారం! ఇది");
  });
  it("a silent restart: the greeting's sound and caption are left out until the person speaks", async () => {
    const quiet = new VoiceClient({ url: "wss://x/v1/tenants/t/voice-chat", token: "tok", language: "en", audio: audio.io, socket: () => ws, onChange: () => undefined, quietStart: true });
    await quiet.start();
    ws.open();
    ws.say({ type: "ready", session_id: "s", language: "en", limits: {} });
    ws.say({ type: "state", state: "speaking" });
    ws.say({ type: "caption", who: "assistant", text: "Hi, how can I help?", final: true, spoken: true });
    ws.say(new ArrayBuffer(8));
    expect(quiet.snapshot.captions).toEqual([]);
    expect(audio.calls.played).toBe(0);
    ws.say({ type: "state", state: "listening" });
    ws.say({ type: "caption", who: "user", text: "hello", final: true, spoken: true });
    ws.say({ type: "state", state: "speaking" });
    ws.say({ type: "caption", who: "assistant", text: "Yes?", final: true, spoken: true });
    ws.say(new ArrayBuffer(8));
    expect(quiet.snapshot.captions.map((c) => c.text)).toEqual(["hello", "Yes?"]);
    expect(audio.calls.played).toBe(1);
  });
  it("a plan is held for the owner (read from the message, a malformed one is ignored), its answer comes by tap or by voice, and the next words clear it", async () => {
    await ready();
    const plan = { type: "confirm_action", action_id: "33333333-3333-4333-8333-333333333333", title: "Call 12 new leads", summary: "Today.", steps: ["Pick", "Call"], count: 12, channel: "call", estimate: { messages: 0, call_minutes: 30, cost_paise: 1200 }, needs_second_factor: true, expires_at: "2026-10-28T20:00:00Z", status: "proposed" };
    ws.say({ ...plan, action_id: "nope" });
    expect(client.snapshot.plan).toBeNull();
    ws.say(plan);
    expect(client.snapshot.plan).toMatchObject({ actionId: "33333333-3333-4333-8333-333333333333", title: "Call 12 new leads", count: 12, channel: "call", needsSecondFactor: true, status: "proposed", estimate: { callMinutes: 30 } });
    ws.say({ type: "action", action_id: "33333333-3333-4333-8333-333333333333", status: "confirmed", task: { id: "t", status: "approved" } });
    expect(client.snapshot.plan?.status).toBe("confirmed");
    expect(client.snapshot.decided).toEqual([{ actionId: "33333333-3333-4333-8333-333333333333", status: "confirmed" }]);
    ws.say({ type: "transcript", text: "and", final: false, seq: 1, t_ms: 100 });
    expect(client.snapshot.plan).toBeNull();
    ws.say({ type: "intent", kind: "business" });
    ws.say({ type: "reply", kind: "answer" });
    ws.say({ type: "clarify", question: "Which leads?", action_id: null }); // spoken and captioned: nothing more to keep
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
