import { describe, expect, it, vi } from "vitest";

import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";

import { startTakeOver, takeOverSocketUrl, type TakeOverState } from "./take-over";

/** app v4 part 4: taking over a live call (C1 #398), with a fake socket and fake audio. */
function fakes(mic: "ok" | "denied" = "ok") {
  const sent: (string | ArrayBuffer)[] = [];
  const played: ArrayBuffer[] = [];
  let onFrame: ((pcm: ArrayBuffer, level: number) => void) | null = null;
  const audio: AudioIO = {
    startMic: vi.fn(async (f) => {
      if (mic === "denied") throw new Error("NotAllowedError");
      onFrame = f;
    }),
    stopMic: vi.fn(),
    play: (pcm) => void played.push(pcm),
    flush: vi.fn(),
    playing: () => false,
    close: vi.fn(),
    analyser: () => null,
  };
  const socket: SocketLike = { binaryType: "", readyState: 0, send: (d) => void sent.push(d), close: vi.fn(function (this: SocketLike) { this.readyState = 3; }), onopen: null, onmessage: null, onclose: null, onerror: null };
  const states: TakeOverState[] = [];
  const opened = vi.fn((_u: string) => socket);
  return { sent, played, audio, socket, states, opened, frame: (b: ArrayBuffer) => onFrame?.(b, 0.2) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const open = (s: SocketLike) => {
  s.readyState = 1;
  s.onopen?.();
};

describe("take over a live call", () => {
  it("the socket's address comes from the API's own address; anything else is none", () => {
    expect(takeOverSocketUrl("https://api.example.test", "t1", "c1")).toBe("wss://api.example.test/v1/tenants/t1/calls/c1/take-over");
    expect(takeOverSocketUrl("javascript:alert(1)", "t1", "c1")).toBeNull();
  });
  it("microphone first, then the sign-in as the first message; nothing is sent before ready; the caller plays here; hand back says so and closes", async () => {
    const f = fakes();
    const s = startTakeOver({ url: "wss://api/x", token: async () => "tok", audio: f.audio, socket: f.opened, onChange: (x) => f.states.push(x) });
    await tick();
    await tick();
    expect(f.audio.startMic).toHaveBeenCalled();
    expect(f.opened).toHaveBeenCalledWith("wss://api/x");
    f.frame(new ArrayBuffer(4)); // before the socket opens: not sent
    open(f.socket);
    expect(f.sent).toEqual([JSON.stringify({ type: "start", access_token: "tok" })]);
    f.frame(new ArrayBuffer(4)); // before ready: not sent
    f.socket.onmessage?.({ data: new ArrayBuffer(8) }); // before ready: not played
    f.socket.onmessage?.({ data: JSON.stringify({ type: "ready", audio_in: { sample_rate: 16000 } }) });
    expect(f.states.at(-1)).toEqual({ phase: "on", error: null });
    const mine = new ArrayBuffer(6);
    f.frame(mine);
    expect(f.sent.at(-1)).toBe(mine);
    const theirs = new ArrayBuffer(10);
    f.socket.onmessage?.({ data: theirs });
    expect(f.played).toEqual([theirs]);
    s.handBack();
    expect(f.sent.at(-1)).toBe(JSON.stringify({ type: "hand_back" }));
    expect(f.socket.close).toHaveBeenCalled();
    expect(f.audio.close).toHaveBeenCalled();
    expect(f.states.at(-1)).toEqual({ phase: "back", error: null });
  });
  it("a refused microphone never opens the socket; no sign-in never opens it either", async () => {
    const f = fakes("denied");
    startTakeOver({ url: "wss://api/x", token: async () => "tok", audio: f.audio, socket: f.opened, onChange: (x) => f.states.push(x) });
    await tick();
    expect(f.opened).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toEqual({ phase: "error", error: "mic" });
    const g = fakes();
    startTakeOver({ url: "wss://api/x", token: async () => null, audio: g.audio, socket: g.opened, onChange: (x) => g.states.push(x) });
    await tick();
    await tick();
    expect(g.opened).not.toHaveBeenCalled();
    expect(g.states.at(-1)).toEqual({ phase: "error", error: "unauthorized" });
  });
  it("the server's closed error words, the call ending, and a socket that closes before ready", async () => {
    for (const [msg, want] of [
      [{ type: "error", code: "call_not_here" }, { phase: "error", error: "call_not_here" }],
      [{ type: "error", code: "something_new" }, { phase: "error", error: "down" }],
      [{ type: "ended" }, { phase: "ended", error: null }],
    ] as const) {
      const f = fakes();
      startTakeOver({ url: "wss://api/x", token: async () => "tok", audio: f.audio, socket: f.opened, onChange: (x) => f.states.push(x) });
      await tick();
      await tick();
      open(f.socket);
      f.socket.onmessage?.({ data: JSON.stringify(msg) });
      expect(f.states.at(-1)).toEqual(want);
      expect(f.audio.close).toHaveBeenCalled();
    }
    const g = fakes();
    startTakeOver({ url: "wss://api/x", token: async () => "tok", audio: g.audio, socket: g.opened, onChange: (x) => g.states.push(x) });
    await tick();
    await tick();
    open(g.socket);
    g.socket.onclose?.({ code: 1006, reason: "" });
    expect(g.states.at(-1)).toEqual({ phase: "error", error: "down" });
  });
});
