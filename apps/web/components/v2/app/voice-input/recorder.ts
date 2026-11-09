"use client";

/**
 * The microphone for typing by voice (owner decision, 9 Nov 2026): a recording in the browser's own memory (MediaRecorder: WebM/Opus on Android, MP4/AAC on an iPhone) plus a level meter, so the page can tell when the person has stopped
 * speaking. Nothing is written anywhere: the chunks stay in an array until the recording is handed to the upload, then the array is emptied and the microphone is released. There is no address for the recording (no object URL) and no copy.
 */
export type Recorder = {
  /** Opens the microphone (the browser asks the person) and starts recording; rejects when it is refused or there is none. */
  start(): Promise<void>;
  /** 0 to 1: how loud it is now (silence is under about 0.02). */
  level(): number;
  /** Ends the recording, releases the microphone and gives the recording (null when nothing was recorded). */
  stop(): Promise<Blob | null>;
  /** Ends it and throws it away (the tab was hidden, the page left). */
  cancel(): void;
};

const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

export function browserRecorder(): Recorder {
  let stream: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
    stream = null;
    ctx = null;
    analyser = null;
    data = null;
    rec = null;
  };
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = TYPES.find((t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)) ?? "";
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      } catch {
        analyser = null; // no meter: the person ends it with a tap (and it still stops at the limit)
      }
      rec.start();
    },
    level() {
      if (!analyser || !data) return 0;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      return Math.sqrt(sum / data.length);
    },
    stop() {
      return new Promise((resolve) => {
        const r = rec;
        const done = (type: string) => {
          const blob = chunks.length ? new Blob(chunks, { type: type || "audio/webm" }) : null;
          chunks = [];
          release();
          resolve(blob);
        };
        if (!r || r.state === "inactive") return done(r?.mimeType ?? "");
        r.onstop = () => done(r.mimeType);
        r.stop();
      });
    },
    cancel() {
      try {
        rec?.stop();
      } catch {
        // already stopped
      }
      chunks = [];
      release();
    },
  };
}
