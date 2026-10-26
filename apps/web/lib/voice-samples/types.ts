import { CALL_LANGS, VOICES, type CallLang, type Voice } from "@/lib/assistant/types";

/**
 * The voice samples of Settings > AI assistant (job DQ part 3): a short recording of one voice, in one call language, in one tone, saying the opening line of a call (which always says it is an AI assistant). The tones are the two C1's
 * sample script makes: warm and crisp. The browser asks OUR route (`<workspace>/voice-sample`), never the API: the person's token stays on the server. Pure: names, checks and the address of a sample.
 */
export const TONES = ["warm", "crisp"] as const;
export type Tone = (typeof TONES)[number];
export const MAX_SAMPLE_BYTES = 2_000_000;

export type SampleQuery = { voice: Voice; lang: CallLang; tone: Tone; name: string };

const NAME = /^[\p{L}\p{M}\p{N} ]{1,24}$/u;

/** The query of a sample request as the browser sent it: each part must be one of the closed words, the name the assistant's name; anything else is null. */
export function readSampleQuery(params: URLSearchParams): SampleQuery | null {
  const voice = params.get("voice");
  const lang = params.get("lang");
  const tone = params.get("tone");
  const name = (params.get("name") ?? "").trim();
  if (!(VOICES as readonly string[]).includes(voice ?? "") || voice === "own_voice") return null;
  if (!(CALL_LANGS as readonly string[]).includes(lang ?? "") || !(TONES as readonly string[]).includes(tone ?? "")) return null;
  if (name !== "" && !NAME.test(name)) return null;
  return { voice: voice as Voice, lang: lang as CallLang, tone: tone as Tone, name };
}

/** The address of a sample, for the page (our own route; nothing here is a secret). */
export function sampleUrl(endpoint: string, q: SampleQuery): string {
  const p = new URLSearchParams({ voice: q.voice, lang: q.lang, tone: q.tone });
  if (q.name) p.set("name", q.name);
  return `${endpoint}?${p.toString()}`;
}
