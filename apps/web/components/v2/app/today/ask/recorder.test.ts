import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canRecord, clock, MAX_SECONDS, MIN_MS, pickMime, problemOf, RecordError, startRecording } from "./recorder";

class Rec {
  static last: Rec | null = null;
  static supported: string[] = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  static isTypeSupported = (m: string) => Rec.supported.includes(m);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  static failStart = false;
  static failStop = false;
  constructor(_s: unknown, public opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
    Rec.last = this;
  }
  start() {
    if (Rec.failStart) throw new Error("no");
    this.state = "recording";
  }
  stop() {
    if (Rec.failStop) throw new Error("no");
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["abc"]) });
    this.onstop?.(new Event("stop"));
  }
}
let track: { stop: ReturnType<typeof vi.fn> };
const media = (impl: () => Promise<unknown>) => Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn(impl) }, configurable: true });

beforeEach(() => {
  track = { stop: vi.fn() };
  Rec.supported = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  Rec.failStart = false;
  Rec.failStop = false;
  vi.stubGlobal("MediaRecorder", Rec);
  media(async () => ({ getTracks: () => [track] }));
});
afterEach(() => vi.unstubAllGlobals());

describe("recorder (job BF)", () => {
  it("the limits are a minute and under a second", () => {
    expect(MAX_SECONDS).toBe(60);
    expect(MIN_MS).toBeLessThan(1000);
  });
  it("picks WebM/Opus first, then plain WebM, then M4A (Safari), then Ogg; none means no microphone", () => {
    expect(pickMime()).toBe("audio/webm;codecs=opus");
    Rec.supported = ["audio/webm", "audio/mp4"];
    expect(pickMime()).toBe("audio/webm");
    Rec.supported = ["audio/mp4"];
    expect(pickMime()).toBe("audio/mp4");
    Rec.supported = ["audio/ogg;codecs=opus"];
    expect(pickMime()).toBe("audio/ogg;codecs=opus");
    Rec.supported = ["video/mp4"];
    expect(pickMime()).toBeNull();
    expect(canRecord()).toBe(false);
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickMime()).toBeNull();
  });
  it("can record only with a microphone API and a type", () => {
    expect(canRecord()).toBe(true);
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(canRecord()).toBe(false);
  });
  it.each([
    ["NotAllowedError", "denied"], ["SecurityError", "denied"], ["PermissionDeniedError", "denied"],
    ["NotFoundError", "nomic"], ["DevicesNotFoundError", "nomic"], ["OverconstrainedError", "nomic"],
    ["NotReadableError", "failed"], ["AbortError", "failed"], ["TypeError", "failed"],
  ])("%s is %s", (name, want) => {
    expect(problemOf(Object.assign(new Error("x"), { name }))).toBe(want);
  });
  it("problemOf copes with things that are not errors", () => {
    expect(problemOf(undefined)).toBe("failed");
    expect(problemOf("NotAllowedError")).toBe("failed");
    expect(problemOf({ name: "NotAllowedError" })).toBe("denied");
  });
  it("starts, stops and gives a Blob of the recorded type; the microphone is released", async () => {
    const r = await startRecording();
    expect(Rec.last!.state).toBe("recording");
    const blob = await r.stop();
    expect(blob.size).toBe(3);
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it("cancel releases the microphone and nothing comes out; stopping after that is refused", async () => {
    const r = await startRecording();
    r.cancel();
    expect(track.stop).toHaveBeenCalled();
    await expect(r.stop()).rejects.toBeInstanceOf(RecordError);
    r.cancel(); // twice is fine
  });
  it("stop twice is refused", async () => {
    const r = await startRecording();
    await r.stop();
    await expect(r.stop()).rejects.toMatchObject({ problem: "failed" });
  });
  it.each([
    ["NotAllowedError", "denied"], ["NotFoundError", "nomic"], ["NotReadableError", "failed"],
  ])("a refused microphone (%s) is a RecordError(%s)", async (name, problem) => {
    media(async () => Promise.reject(Object.assign(new Error("x"), { name })));
    await expect(startRecording()).rejects.toMatchObject({ problem });
  });
  it("no recorder type, or no microphone API, is `unsupported`", async () => {
    Rec.supported = [];
    await expect(startRecording()).rejects.toMatchObject({ problem: "unsupported" });
  });
  it("a recorder that cannot be made or started lets the microphone go and says so", async () => {
    Rec.failStart = true;
    await expect(startRecording()).rejects.toMatchObject({ problem: "failed" });
    expect(track.stop).toHaveBeenCalled();
    vi.stubGlobal("MediaRecorder", Object.assign(class { constructor() { throw new Error("x"); } }, { isTypeSupported: () => true }));
    track.stop.mockClear();
    await expect(startRecording()).rejects.toMatchObject({ problem: "unsupported" });
    expect(track.stop).toHaveBeenCalled();
  });
  it("a recorder that throws on stop is a failed recording, and the microphone is let go", async () => {
    const r = await startRecording();
    Rec.failStop = true;
    await expect(r.stop()).rejects.toMatchObject({ problem: "failed" });
    expect(track.stop).toHaveBeenCalled();
  });
  it("the clock: m:ss, rounded up, never negative", () => {
    expect([60, 59.2, 42, 9.1, 0.2, 0, -3].map(clock)).toEqual(["1:00", "1:00", "0:42", "0:10", "0:01", "0:00", "0:00"]);
  });
});

describe("the microphone's level for the circle", () => {
  it("puts an analyser of the microphone where the circles read it, and takes it away when the recording is released", async () => {
    const { setAnalyser } = await import("./audio-level");
    const analyser = {} as AnalyserNode;
    const closed = vi.fn(async () => undefined);
    vi.stubGlobal("AudioContext", class { createMediaStreamSource() { return { connect: vi.fn() }; } createAnalyser() { return Object.assign(analyser, { fftSize: 0, smoothingTimeConstant: 0 }); } close = closed; });
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    class FakeRecorder { static isTypeSupported = () => true; mimeType = "audio/webm"; state = "inactive"; ondataavailable: unknown = null; onstop: (() => void) | null = null; onerror: unknown = null; start() { this.state = "recording"; } stop() { this.state = "inactive"; this.onstop?.(); } }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const seen: (AnalyserNode | null)[] = [];
    const { useAnalyser } = await import("./audio-level");
    const { render, cleanup, act } = await import("@testing-library/react");
    const Probe = () => (seen.push(useAnalyser()), null);
    const { createElement } = await import("react");
    render(createElement(Probe));
    const { startRecording } = await import("./recorder");
    let rec!: Awaited<ReturnType<typeof startRecording>>;
    await act(async () => void (rec = await startRecording()));
    expect(seen.at(-1)).toBe(analyser);
    act(() => rec.cancel());
    expect(seen.at(-1)).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    setAnalyser(null);
    cleanup();
    vi.unstubAllGlobals();
  });
});
