/** The browser's speech recognition (Chrome and Safari name it differently; Firefox has none). Not part of the TypeScript DOM library, so only the parts the box uses are described. */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Ctor = new () => Recognition;

/** The language chip's language, as the browser wants it. Tamil is here for when the chip offers it. */
export const SPEECH_LANG: Record<string, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN", ta: "ta-IN" };
export const speechLang = (lang: string): string => SPEECH_LANG[lang] ?? "en-IN";

export function recognitionCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** What went wrong, in the words the box has: the person denied the microphone, said nothing, or the service failed. */
export function speechProblem(code: string | undefined): "denied" | "silent" | "failed" {
  if (code === "not-allowed" || code === "service-not-allowed") return "denied";
  if (code === "no-speech") return "silent";
  return "failed";
}

/** Everything heard so far, interim words included, as one line. */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  return Array.from(results, (r) => r[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim();
}
