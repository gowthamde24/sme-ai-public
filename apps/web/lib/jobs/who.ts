import type { JobKind } from "./types";

/**
 * WHO TALKS (JOBS; owner decision 19 Nov 2026: "each job can have its own name, voice, language, number and tone"). The job page's "Who talks" card reads and writes ONE small object, `speaks`, in the closed words below. The name is the job's own (`customName`, with the
 * AI disclosure the API always adds); `speaks` is the rest. The wire shape is the proposal in contracts/jobs-templates-web-needs.md (#10, extended) and contracts/template-builder-web-needs.md: `GET /jobs/{id}` carries `speaks {language, tone, voice, number}` and the
 * `numbers` the workspace has, and `PATCH /jobs/{id} {speaks: {...only what changed}}` changes it. The assistant's "make the visits job speak Telugu" is the same patch (`jobs.change`).
 */
export const WHO_LANGUAGES = ["customer", "en", "te", "hi", "kn"] as const;
export type WhoLanguage = (typeof WHO_LANGUAGES)[number];
/** The three tones, the same words as the voice card and C1's `tone` (voices-tones.md section 3, 21 Nov 2026): Friendly ("Hi Suresh, ..."), Respectful ("Namaskaram Suresh garu, ..."), Short and quick (the answer first). */
export const WHO_TONES = ["friendly", "respectful", "quick"] as const;
export type WhoTone = (typeof WHO_TONES)[number];
/** A voice is a catalogue id (`te-ramya`, `hi-kabir`): THE SAME list as the voice card (`GET /ai-assistant/voices`, voices-tones.md section 9). The three ids of the Jobs 1.1 draft (female_warm, female_clear, male_calm) are retired. */
export type WhoVoice = string;
export const isWhoVoice = (v: unknown): v is WhoVoice => typeof v === "string" && /^[a-z]{2}-[a-z0-9][a-z0-9_.-]{1,50}$/.test(v); // language, a hyphen, the first name: the retired ids (female_warm ...) have no hyphen
/** A voice of the catalogue as the card shows it: its first name ("Ramya"), its language and whether it is the recommended one. Every voice can be played (a recording, or live when it has none). */
export type WhoVoiceName = { id: WhoVoice; name: string; language: string; recommended: boolean };
/**
 * Which number the job calls and writes from: the SHOP's own, and only that (C1 contract 1.1 part 1, section 4 C4: the second number is NOT a product yet; `numbers` lists only `shop`, `number: "second"` is never sent and a PATCH to it is `422 setting_invalid`).
 * So the card shows the shop's number in the sentence as a plain word (no choice), and the web never sends a change of number.
 */
export const WHO_NUMBERS = ["shop"] as const;
export type WhoNumber = (typeof WHO_NUMBERS)[number];

export type WhoNumberInfo = { key: WhoNumber; /** shown as the API sends it, the middle digits hidden: "+91 98480 xxx10" */ masked: string };
/** `voice` is the catalogue id (the Play button uses it); `voiceName` is the voice's first name ("Ramya"), always sent with the voice: the chip shows the NAME. */
export type JobWho = { language: WhoLanguage; tone: WhoTone; voice: WhoVoice; voiceName: string | null; number: WhoNumber; numbers: readonly WhoNumberInfo[] };
export type Speaks = Pick<JobWho, "language" | "tone" | "voice" | "number">;
/** What a change carries: only what changed (language, tone, voice: the number is not a choice). */
export type SpeaksPatch = Partial<Pick<Speaks, "language" | "tone" | "voice">>;

const LISTS = { language: WHO_LANGUAGES, tone: WHO_TONES } as const;
export type SpeaksKey = keyof typeof LISTS | "voice";
export const isSpeaksKey = (k: unknown): k is SpeaksKey => typeof k === "string" && (k in LISTS || k === "voice");
/** Is `value` allowed for this key: one of the closed words, or (the voice) a catalogue id. */
const allowed = (key: SpeaksKey, value: unknown): boolean => (key === "voice" ? isWhoVoice(value) : typeof value === "string" && (LISTS[key] as readonly string[]).includes(value));

/** ONE choice as the patch the adapter sends (`PATCH /jobs/{id} {speaks: patch}`); null when the value is not one of the closed words. The page, the action and the tests all build the patch HERE. */
export function speaksPatch(key: SpeaksKey, value: string): SpeaksPatch | null {
  return isSpeaksKey(key) && allowed(key, value) ? ({ [key]: value } as SpeaksPatch) : null;
}
/** The patch as it goes on the wire. */
export const speaksBody = (patch: SpeaksPatch): { speaks: SpeaksPatch } => ({ speaks: patch });
/** A patch from untrusted input (a server action's argument): only the closed words, at least one, nothing else. */
export function readSpeaksPatch(v: unknown): SpeaksPatch | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!isSpeaksKey(k) || typeof val !== "string" || !allowed(k, val)) return null;
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? (out as SpeaksPatch) : null;
}

/** The one other job the card offers to change by talking ("Make the visits job speak Telugu"): its id, kind and own name, how it speaks now and how the command would make it speak. */
export type WhoTarget = { id: string; kind: JobKind; customName: string | null; language: WhoLanguage; to: WhoLanguage };
