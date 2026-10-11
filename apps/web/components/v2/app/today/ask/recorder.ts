/**
 * Recording a question in the browser (job BF): the microphone through `getUserMedia`, recorded by `MediaRecorder` as WebM/Opus (Chrome, Firefox, Edge) or M4A/MP4 (Safari), both of which the Agent OWL's
 * voice route reads. A low bit rate keeps a full minute of speech far below the route's 1.5 MB limit. Nothing here is sent anywhere; the caller gets a Blob, or throws a RecordError with a closed `problem`.
 */
export const MAX_SECONDS = 60;
/** A recording shorter than this is an accidental touch, not a question. */
export const MIN_MS = 700;
const BITS_PER_SECOND = 32_000;
const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

/** `denied`: the person (or the browser) refused the microphone; `nomic`: there is none; `unsupported`: this browser cannot record; `failed`: anything else. */
export type RecordProblem = "denied" | "nomic" | "unsupported" | "failed";
export class RecordError extends Error {
  constructor(readonly problem: RecordProblem) {
    super(problem);
  }
}

/** The first recording type this browser can make, or null. */
export function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Whether this browser can record at all: a microphone API and a recorder with a type the API reads. Without it no microphone button is drawn. */
export function canRecord(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && pickMime() !== null;
}

export function problemOf(error: unknown): RecordProblem {
  const name = error instanceof Error || (typeof error === "object" && error !== null && "name" in error) ? String((error as { name?: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "nomic";
  return "failed";
}

export type Recording = {
  /** Ends the recording and gives the audio. */
  stop(): Promise<Blob>;
  /** Throws the recording away; the microphone is released. */
  cancel(): void;
};

/** Asks for the microphone and starts recording. Rejects with a RecordError. */
export async function startRecording(): Promise<Recording> {
  const mime = pickMime();
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function" || mime === null) throw new RecordError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw new RecordError(problemOf(error));
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BITS_PER_SECOND });
  } catch {
    release();
    throw new RecordError("unsupported");
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  try {
    recorder.start();
  } catch {
    release();
    throw new RecordError("failed");
  }
  let done = false;
  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        if (done) return reject(new RecordError("failed"));
        done = true;
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType || mime }));
        };
        recorder.onerror = () => {
          release();
          reject(new RecordError("failed"));
        };
        try {
          if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
          else recorder.stop();
        } catch {
          release();
          reject(new RecordError("failed"));
        }
      }),
    cancel: () => {
      if (done) return;
      done = true;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // already stopped
      }
      release();
    },
  };
}

/** m:ss for the countdown: 60 -> "1:00", 42 -> "0:42". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
