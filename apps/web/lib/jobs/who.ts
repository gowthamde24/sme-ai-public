import { sampleUrl, type SampleQuery } from "@/lib/voice-samples/types";

/**
 * WHO TALKS (JOBS; owner decision 19 Nov 2026: "each job can have its own name, voice, language, number and tone"). The job page's "Who talks" card reads and writes ONE small object, `speaks`, in the closed words below. The name is the job's own (`customName`, with the
 * AI disclosure the API always adds); `speaks` is the rest. The wire shape is the proposal in contracts/jobs-templates-web-needs.md (#10, extended) and contracts/template-builder-web-needs.md: `GET /jobs/{id}` carries `speaks {language, tone, voice, number}` and the
 * `numbers` the workspace has, and `PATCH /jobs/{id} {speaks: {...only what changed}}` changes it. The assistant's "make the visits job speak Telugu" is the same patch (`jobs.change`).
 */
export const WHO_LANGUAGES = ["customer", "en", "te", "hi", "kn"] as const;
export type WhoLanguage = (typeof WHO_LANGUAGES)[number];
/** The three tones of the owner's words: Respectful ("Namaskaram Suresh garu"), Friendly ("Hi Suresh garu"), Casual ("Hi Suresh"). */
export const WHO_TONES = ["respectful", "friendly", "casual"] as const;
export type WhoTone = (typeof WHO_TONES)[number];
/** Three voices, named by how they sound (never by an invented person's name): the catalogue's ids, the ones the voice sample route plays. */
export const WHO_VOICES = ["female_warm", "female_clear", "male_calm"] as const;
export type WhoVoice = (typeof WHO_VOICES)[number];
/** Which number the job calls and writes from: the shop's own, or a second one the shop has. */
export const WHO_NUMBERS = ["shop", "second"] as const;
export type WhoNumber = (typeof WHO_NUMBERS)[number];

export type WhoNumberInfo = { key: WhoNumber; /** shown as the API sends it, the middle digits hidden: "+91 98480 xxx10" */ masked: string };
export type JobWho = { language: WhoLanguage; tone: WhoTone; voice: WhoVoice; number: WhoNumber; numbers: readonly WhoNumberInfo[] };
export type Speaks = Pick<JobWho, "language" | "tone" | "voice" | "number">;
/** What a change carries: only what changed. */
export type SpeaksPatch = Partial<Speaks>;

const LISTS = { language: WHO_LANGUAGES, tone: WHO_TONES, voice: WHO_VOICES, number: WHO_NUMBERS } as const;
export type SpeaksKey = keyof typeof LISTS;
export const isSpeaksKey = (k: unknown): k is SpeaksKey => typeof k === "string" && k in LISTS;

/** ONE choice as the patch the adapter sends (`PATCH /jobs/{id} {speaks: patch}`); null when the value is not one of the closed words. The page, the action and the tests all build the patch HERE. */
export function speaksPatch(key: SpeaksKey, value: string): SpeaksPatch | null {
  return (LISTS[key] as readonly string[]).includes(value) ? ({ [key]: value } as SpeaksPatch) : null;
}
/** The patch as it goes on the wire. */
export const speaksBody = (patch: SpeaksPatch): { speaks: SpeaksPatch } => ({ speaks: patch });
/** A patch from untrusted input (a server action's argument): only the closed words, at least one, nothing else. */
export function readSpeaksPatch(v: unknown): SpeaksPatch | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!isSpeaksKey(k) || typeof val !== "string" || !(LISTS[k] as readonly string[]).includes(val)) return null;
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? (out as SpeaksPatch) : null;
}

/** The sample a play button plays: the voice sample route's own query (`voice-sample?voice=&lang=&tone=&name=`): warm for Friendly and Casual, crisp for Respectful; "the customer's language" plays in the person's own language. */
export function whoSample(endpoint: string, who: Pick<Speaks, "language" | "tone">, voice: WhoVoice, uiLang: string, name: string | null): string {
  const lang = who.language === "customer" ? (["te", "hi", "kn", "en"].includes(uiLang) ? uiLang : "en") : who.language;
  const q: SampleQuery = { voice, lang: lang as SampleQuery["lang"], tone: who.tone === "respectful" ? "crisp" : "warm", name: name !== null && /^[\p{L}\p{M}\p{N} ]{1,24}$/u.test(name) ? name : "" };
  return sampleUrl(endpoint, q);
}
