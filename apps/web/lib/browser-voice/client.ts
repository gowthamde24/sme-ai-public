import type { ConfirmAction } from "@/lib/api/turns";

import { BARGE_IN, BARGE_IN_VERIFY, endWordOf, parseServerMessage, PING, setLanguageMessage, startMessage, STOP, type EndWord, type LimitReason, type ServerMessage, type Step, type VoiceLang, type VoiceSource, type VoiceMode, type VoiceState } from "./protocol";

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
export type Caption = { id: number; who: "user" | "assistant"; text: string; final: boolean; spoken: boolean; /** The person spoke over it: only the words up to here were heard (the thread marks it "Interrupted"). */ cut?: boolean };
export type Snapshot = { phase: Phase; state: VoiceState | null; step: Step | null; captions: Caption[]; sources: VoiceSource[]; language: VoiceLang; end: EndWord | null; micDenied: boolean; /** The plan the assistant proposed in this turn, waiting for the owner (null otherwise). */ plan: ConfirmAction | null; /** The answers to plans so far (by tap or by voice), in order. */ decided: { actionId: string; status: "confirmed" | "declined" | "expired" }[]; /** The voice speaking now (its name and language), as the API said at the start of the turn; null until it says. */ voice: { id: string; name: string | null; language: VoiceLang | null } | null; /** The conversation the spoken turns are stored in (the written chat's thread); null until the API says. */ conversationId: string | null; /** A refusal that does not end the session (the hourly limit, ...): its code, until the next turn. */ problem: string | null; /** The length of one conversation in seconds, as the API said at the start (null: it did not say), and when it started (ms): the screen warns before the end. */ sessionSeconds: number | null; readyAt: number | null; /** The API said the session ends in this many seconds (a soft warning before its limit), and when that was said (ms); null before. */ endingIn: number | null; endingAt: number | null };

/** A level above this (0..1, after the browser's echo cancelling) is the person speaking; it must hold for this many frames in a row, so a click or a cough does not cut the assistant off. */
export const SPEECH_LEVEL = 0.06;
export const SPEECH_FRAMES = 3;
/** How many microphone frames dictation keeps while the socket opens. */
export const EARLY_FRAMES = 80;

export type Options = { /** Pin the recogniser to this language (dictation in the app language: the first words come in its script, not as Latin guesses); default: any language. */ sttLanguage?: VoiceLang | null; /** "dictate": words only (the API never answers); default "live". */ mode?: VoiceMode; /** The written chat's conversation: the spoken turns join it. */ conversationId?: string | null; url: string; token: string; language: VoiceLang; audio: AudioIO; socket: (url: string) => SocketLike; onChange: (s: Snapshot) => void; /** A restart the person did not ask to hear a greeting for: the greeting (its sound and its caption) is left out until they speak. */ quietStart?: boolean };

export class VoiceClient {
  private ws: SocketLike | null = null;
  private snap: Snapshot;
  private serverState: VoiceState | null = null;
  private loud = 0;
  private seq = 0;
  private last: { limit?: LimitReason; errorCode?: string } = {};
  private ping: ReturnType<typeof setInterval> | null = null;
  /** Dictation: the first words are spoken while the socket is still opening; the frames are kept (about 6 s at most) and sent as soon as the API is ready, so the start of the sentence is not lost. */
  private early: ArrayBuffer[] = [];
  private finished = false;
  private quiet: boolean; // a silent restart: nothing of the assistant is heard or shown until the person has spoken

  constructor(private readonly o: Options) {
    this.quiet = o.quietStart === true;
    this.snap = { phase: "connecting", state: null, step: null, captions: [], sources: [], language: o.language, end: null, micDenied: false, plan: null, decided: [], voice: null, conversationId: null, problem: null, sessionSeconds: null, readyAt: null, endingIn: null, endingAt: null };
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
    ws.onopen = () => ws.send(startMessage(this.o.token, this.snap.language, { mode: this.o.mode, conversationId: this.o.conversationId, sttLanguage: this.o.sttLanguage }));
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

  /** The assistant's last words were cut off by the person (a tap, or speaking over it): that turn is marked, so the thread says "Interrupted". `spoken` = what the person actually heard of it, when the API says: only that stays as the assistant's words. */
  private markCut(spoken: string | null = null): void {
    const list = this.snap.captions.slice();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].who !== "assistant") continue;
      const text = spoken !== null && spoken !== list[i].text ? spoken : list[i].text;
      if (!list[i].cut || text !== list[i].text) {
        list[i] = { ...list[i], cut: true, text, final: true };
        this.set({ captions: list });
      }
      return;
    }
  }

  /** A tap while the assistant talks: the sound stops HERE, the API is told, and the microphone goes on (the same as speaking over it). */
  bargeIn(): void {
    if (!this.ws || this.ws.readyState !== 1 || (this.serverState !== "speaking" && this.serverState !== "paused")) return;
    this.markCut();
    this.o.audio.flush();
    this.ws.send(BARGE_IN);
    this.serverState = "listening";
    this.set({ state: "listening" });
  }

  setLanguage(language: VoiceLang | "auto"): void {
    if (language !== "auto") this.set({ language });
    if (this.ws && this.ws.readyState === 1) this.ws.send(setLanguageMessage(language));
  }

  private frame(pcm: ArrayBuffer, level: number): void {
    const ws = this.ws;
    if (this.o.mode === "dictate" && this.snap.phase === "connecting") {
      this.early.push(pcm);
      if (this.early.length > EARLY_FRAMES) this.early.shift();
      return;
    }
    if (!ws || ws.readyState !== 1 || this.snap.phase !== "ready") return;
    if (this.o.mode === "dictate") return void ws.send(pcm); // words only: the microphone goes all the time, nothing is ever spoken back
    if (this.serverState === "speaking") {
      this.loud = level > SPEECH_LEVEL ? this.loud + 1 : 0;
      if (this.loud >= SPEECH_FRAMES) {
        this.loud = 0;
        this.o.audio.flush(); // the sound stops here first...
        ws.send(BARGE_IN_VERIFY); // ...and the API is told to judge it: a cough or "hmm" and the reply goes on, real words end it
        this.serverState = "paused";
        this.set({ state: "paused" });
      }
    }
    if (this.serverState === "listening" || this.serverState === "paused") ws.send(pcm); // while the assistant listens, and while it judges what it heard (it needs the sound to tell)
  }

  private message(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      if (this.snap.phase === "ready" && this.serverState !== "listening" && this.serverState !== "paused" && !this.quiet) this.o.audio.play(data);
      return;
    }
    const m: ServerMessage | null = parseServerMessage(data);
    if (m === null) return;
    switch (m.type) {
      case "ready":
        if (this.o.mode === "dictate" && this.ws && this.ws.readyState === 1) for (const f of this.early.splice(0)) this.ws.send(f);
        this.set({ phase: "ready", language: m.language, conversationId: m.conversationId, problem: null, sessionSeconds: m.sessionSeconds, readyAt: Date.now() });
        return;
      case "state":
        if (m.state === "listening" && this.serverState === "paused") this.markCut(); // it judged the sound to be the person speaking: the reply ended where it was
        this.serverState = m.state;
        this.loud = 0;
        if (m.state === "thinking") this.quiet = false;
        this.set({ state: m.state, step: m.state === "thinking" ? m.step : null, ...(m.state === "thinking" ? { problem: null } : {}) });
        return;
      case "transcript":
        this.heard(m.text, m.final); // the person's words live: the interim line is replaced as newer ones come, and by the settled words
        this.set({ plan: null });
        return;
      case "confirm_action":
        this.set({ plan: m.action });
        return;
      case "action":
        this.set({ decided: [...this.snap.decided, { actionId: m.actionId, status: m.status }].slice(-10), plan: this.snap.plan && this.snap.plan.actionId === m.actionId ? { ...this.snap.plan, status: m.status } : this.snap.plan });
        return;
      case "caption": {
        if (m.who === "user") return this.heard(m.text, m.final); // the same words as the `transcript` messages say: ONE line per utterance, whichever message comes first
        if (this.quiet) return;
        const list = this.snap.captions.slice();
        const lastOne = list[list.length - 1];
        // the assistant's words come in pieces (a few letters each, final each): they are one text, joined as they are, never a line per piece
        if (lastOne && lastOne.who === "assistant" && m.spoken === lastOne.spoken) list[list.length - 1] = { ...lastOne, text: lastOne.final ? lastOne.text + m.text : m.text, final: m.final };
        else list.push({ id: ++this.seq, who: "assistant", text: m.text, final: m.final, spoken: m.spoken });
        this.set({ captions: list.slice(-30) });
        return;
      }
      case "audio_stop":
        this.o.audio.flush();
        return;
      case "interrupted": // the API heard the person over the assistant: the turn is cut where they heard it
        this.markCut(m.spoken);
        return;
      case "paused": // judging a sound: nothing is played meanwhile
        this.o.audio.flush();
        this.serverState = "paused";
        this.loud = 0;
        this.set({ state: "paused" });
        return;
      case "resumed": // it was a cough, a click or "hmm": the reply goes on (the API sends the audio again)
        this.serverState = "speaking";
        this.set({ state: "speaking" });
        return;
      case "notice":
        this.set({ endingIn: m.secondsLeft, endingAt: Date.now() });
        return;
      case "source":
        if (!this.snap.sources.some((s) => s.label === m.label)) this.set({ sources: [...this.snap.sources, { kind: m.kind, label: m.label }].slice(-8) });
        return;
      case "language":
        this.set({ language: m.language });
        return;
      case "voice":
        this.set({ voice: { id: m.voiceId, name: m.name, language: m.language } });
        return;
      case "error":
        this.last.errorCode = m.code;
        if (!m.fatal) this.set({ problem: m.code }); // the session goes on: the chat says why in words
        return;
      case "limit":
        this.last.limit = m.reason;
        if (m.reason === "goodbye") this.o.audio.stopMic(); // the person said bye: the microphone is off at once (the goodbye is still played; the close follows)
        return;
      default:
        return;
    }
  }

  /** What the person says, from either message: while an utterance is open (a partial, or a final that a second message repeats) its line is replaced in place; a partial after a final is a new utterance. */
  private heard(text: string, final: boolean): void {
    this.quiet = false;
    const list = this.snap.captions.slice();
    const lastOne = list[list.length - 1];
    if (lastOne && lastOne.who === "user" && (!lastOne.final || final)) list[list.length - 1] = { ...lastOne, text, final };
    else list.push({ id: ++this.seq, who: "user", text, final, spoken: true });
    this.set({ captions: list.slice(-30) });
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
