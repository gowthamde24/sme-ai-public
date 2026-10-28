import { BARGE_IN, endWordOf, parseServerMessage, PING, setLanguageMessage, startMessage, STOP, type EndWord, type LimitReason, type ServerMessage, type Step, type VoiceLang, type VoiceSource, type VoiceState } from "./protocol";

/**
 * One "Talk to your assistant" session (job DV): the WebSocket, the microphone and the speakers, kept apart from the screen so they can be tested with fakes. The browser holds the person's sign-in only for the first message (the API's contract: a socket cannot send a
 * header); the microphone is sent only while the assistant listens (speech-recognition time is counted and capped), and the moment the person speaks while the assistant talks the sound is stopped HERE first and the API told after (barge-in, under 200 ms).
 */
export interface AudioIO {
  /** Opens the microphone (after a tap) and calls `onFrame` with each frame as 16 kHz PCM16 and its loudness (0..1). Rejects when the person says no. */
  startMic(onFrame: (pcm: ArrayBuffer, level: number) => void): Promise<void>;
  stopMic(): void;
  /** Queues 24 kHz PCM16 of the assistant's voice, in order. */
  play(pcm: ArrayBuffer): void;
  /** Stops everything queued or playing, at once. */
  flush(): void;
  /** True while a sound is queued or playing. */
  playing(): boolean;
  close(): void;
  /** For the circle: follows the microphone or the voice. */
  analyser(which: "mic" | "voice"): AnalyserNode | null;
}
export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}
export type Phase = "connecting" | "ready" | "ended";
export type Caption = { id: number; who: "user" | "assistant"; text: string; final: boolean; spoken: boolean };
export type Snapshot = { phase: Phase; state: VoiceState | null; step: Step | null; captions: Caption[]; sources: VoiceSource[]; language: VoiceLang; end: EndWord | null; micDenied: boolean };

/** A level above this (0..1, after the browser's echo cancelling) is the person speaking; it must hold for this many frames in a row, so a click or a cough does not cut the assistant off. */
export const SPEECH_LEVEL = 0.06;
export const SPEECH_FRAMES = 3;

export type Options = { url: string; token: string; language: VoiceLang; audio: AudioIO; socket: (url: string) => SocketLike; onChange: (s: Snapshot) => void };

export class VoiceClient {
  private ws: SocketLike | null = null;
  private snap: Snapshot;
  private serverState: VoiceState | null = null;
  private loud = 0;
  private seq = 0;
  private last: { limit?: LimitReason; errorCode?: string } = {};
  private ping: ReturnType<typeof setInterval> | null = null;
  private finished = false;

  constructor(private readonly o: Options) {
    this.snap = { phase: "connecting", state: null, step: null, captions: [], sources: [], language: o.language, end: null, micDenied: false };
  }

  get snapshot(): Snapshot {
    return this.snap;
  }
  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.o.onChange(this.snap);
  }

  /** Call from the tap: the microphone and the speakers need it. */
  async start(): Promise<void> {
    try {
      await this.o.audio.startMic((pcm, level) => this.frame(pcm, level));
    } catch {
      this.set({ phase: "ended", end: "refused", micDenied: true });
      this.o.audio.close();
      return;
    }
    const ws = this.o.socket(this.o.url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(startMessage(this.o.token, this.snap.language));
    ws.onmessage = (event) => this.message(event.data);
    ws.onclose = (event) => this.closed(event);
    ws.onerror = () => undefined; // a close follows
    this.ping = setInterval(() => ws.readyState === 1 && ws.send(PING), 20_000);
  }

  /** The person ends it (a second tap, Close). */
  stop(): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(STOP);
    this.finish({ code: 1000, reason: "" });
  }

  /** A tap while the assistant talks: the sound stops HERE, the API is told, and the microphone goes on (the same as speaking over it). */
  bargeIn(): void {
    if (!this.ws || this.ws.readyState !== 1 || this.serverState !== "speaking") return;
    this.o.audio.flush();
    this.ws.send(BARGE_IN);
    this.serverState = "listening";
    this.set({ state: "listening" });
  }

  setLanguage(language: VoiceLang): void {
    this.set({ language });
    if (this.ws && this.ws.readyState === 1) this.ws.send(setLanguageMessage(language));
  }

  private frame(pcm: ArrayBuffer, level: number): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.snap.phase !== "ready") return;
    if (this.serverState === "speaking") {
      this.loud = level > SPEECH_LEVEL ? this.loud + 1 : 0;
      if (this.loud >= SPEECH_FRAMES) {
        this.loud = 0;
        this.o.audio.flush(); // the sound stops here first...
        ws.send(BARGE_IN); // ...and the API is told
        this.serverState = "listening";
        this.set({ state: "listening" });
      }
    }
    if (this.serverState === "listening") ws.send(pcm); // only while the assistant listens
  }

  private message(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      if (this.snap.phase === "ready" && this.serverState !== "listening") this.o.audio.play(data);
      return;
    }
    const m: ServerMessage | null = parseServerMessage(data);
    if (m === null) return;
    switch (m.type) {
      case "ready":
        this.set({ phase: "ready", language: m.language });
        return;
      case "state":
        this.serverState = m.state;
        this.loud = 0;
        this.set({ state: m.state, step: m.state === "thinking" ? m.step : null });
        return;
      case "caption": {
        const list = this.snap.captions.slice();
        const lastOne = list[list.length - 1];
        if (lastOne && lastOne.who === m.who && !lastOne.final && m.spoken === lastOne.spoken) list[list.length - 1] = { ...lastOne, text: m.text, final: m.final }; // a partial is replaced
        else list.push({ id: ++this.seq, who: m.who, text: m.text, final: m.final, spoken: m.spoken });
        this.set({ captions: list.slice(-30) });
        return;
      }
      case "audio_stop":
        this.o.audio.flush();
        return;
      case "source":
        if (!this.snap.sources.some((s) => s.label === m.label)) this.set({ sources: [...this.snap.sources, { kind: m.kind, label: m.label }].slice(-8) });
        return;
      case "language":
        this.set({ language: m.language });
        return;
      case "error":
        this.last.errorCode = m.code;
        return;
      case "limit":
        this.last.limit = m.reason;
        return;
      default:
        return;
    }
  }

  private closed(event: { code: number; reason: string }): void {
    this.finish(event);
  }
  private finish(close: { code: number; reason: string }): void {
    if (this.finished) return;
    this.finished = true;
    if (this.ping) clearInterval(this.ping);
    this.o.audio.stopMic();
    this.o.audio.flush();
    this.o.audio.close();
    try {
      this.ws?.close(1000);
    } catch {
      /* already closed */
    }
    this.set({ phase: "ended", state: null, step: null, end: this.snap.end ?? endWordOf(close, this.last) });
  }
}
