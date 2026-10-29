import type { CallLang } from "@/lib/assistant/types";

/**
 * The voice picker (owner decision 28 Oct, job-voice-picker.md; Settings > AI assistant > Voice): the catalogue of approved voices, and the voice the workspace chose for each language (none = the default of that language). The shapes the screen reads;
 * every answer is checked (lib/api/voice-picker.ts has C1's contract). A sample is a short recording made ONCE for each voice and kept as a file: the browser plays it through this app's own route.
 */
export const PICKER_LANGS = ["te", "en", "hi", "kn", "ta", "ml"] as const satisfies readonly CallLang[];
/** Every supported language, the workspace's own first (in the catalogue's order inside each group): the Voice section draws a row for all of them. */
export function pickerOrder(own: readonly string[]): PickerLang[] {
  return [...PICKER_LANGS.filter((l) => own.includes(l)), ...PICKER_LANGS.filter((l) => !own.includes(l))];
}
export type PickerLang = (typeof PICKER_LANGS)[number];
export const GENDERS = ["female", "male"] as const;
export type Gender = (typeof GENDERS)[number];
export const VOICE_ID = /^[a-z0-9][a-z0-9_.-]{1,59}$/;

export type PickerVoice = {
  id: string;
  language: PickerLang;
  /** The voice's first name ("Janvi"). */
  name: string;
  /** A short label in plain words ("Calm", "Cheerful", "Male"), as the catalogue says it (the first of the tags). */
  label: string;
  /** The style tags in plain words (calm, warm, deep, bright, young, mature, energetic), lower case. */
  tags: string[];
  /** The catalogue's two or three suggestions for the language: they carry a "Recommended" badge. */
  recommended: boolean;
  gender: Gender;
  isDefault: boolean;
  /** A path on the API of the pre-rendered sample, or null when there is none yet. The browser never gets it: it asks this app's route. */
  sampleUrl: string | null;
  /** The exact words of the sample (C1's `sample_text`), shown under the voice once it has been played; null when the API does not say. */
  sampleText: string | null;
};
export type Choices = Partial<Record<PickerLang, string | null>>;
/** `gender`: the ONE switch of the workspace (Female / Male); `voices` has the voices of both genders for every language (the screen shows the ones of the gender), `choices` the voice picked per language. */
export type Picker = { gender: Gender; voices: PickerVoice[]; choices: Choices; fake: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPickerLang = (l: unknown): l is PickerLang => (PICKER_LANGS as readonly unknown[]).includes(l);

/** The path of a sample: on the API (a plain path that starts with a slash, no host, no way up and out), or nothing. */
export const safeSamplePath = (v: unknown): string | null => (typeof v === "string" && /^\/[A-Za-z0-9_\-./]{1,200}(\?[A-Za-z0-9_\-.=&]{1,100})?$/.test(v) && !v.includes("..") && !v.startsWith("//") ? v : null);

export function parsePicker(json: unknown): Picker | null {
  if (!isRecord(json) || !Array.isArray(json.languages)) return null;
  const voices: PickerVoice[] = [];
  const choices: Choices = {};
  for (const row of json.languages) {
    if (!isRecord(row) || typeof row.language !== "string" || !Array.isArray(row.voices)) return null;
    if (!isPickerLang(row.language)) continue; // a language the picker has no row for is left out
    const language = row.language;
    for (const r of row.voices) {
      if (!isRecord(r) || typeof r.id !== "string" || !VOICE_ID.test(r.id) || typeof r.name !== "string" || r.name.length < 1 || r.name.length > 40 || (r.label !== undefined && (typeof r.label !== "string" || r.label.length > 30)) || typeof r.default !== "boolean") return null;
      if (!(GENDERS as readonly unknown[]).includes(r.gender)) return null;
      const tags = Array.isArray(r.tags) ? r.tags.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 20).slice(0, 6).map((x) => x.toLowerCase()) : [];
      voices.push({ id: r.id, language, name: r.name, label: typeof r.label === "string" && r.label !== "" ? r.label : (tags[0] ?? ""), tags: tags.length > 0 ? tags : typeof r.label === "string" && r.label !== "" ? [r.label.toLowerCase()] : [], recommended: r.recommended === true, gender: r.gender as Gender, isDefault: r.default, sampleUrl: r.sample_url === null || r.sample_url === undefined ? null : safeSamplePath(r.sample_url), sampleText: typeof r.sample_text === "string" && r.sample_text.trim() !== "" && r.sample_text.length <= 1000 ? r.sample_text : null });
    }
    const chosen = row.chosen_id;
    if (chosen === undefined || chosen === null) continue;
    if (typeof chosen !== "string" || !VOICE_ID.test(chosen)) return null;
    choices[language] = chosen;
  }
  return { gender: json.gender === "male" ? "male" : "female", voices, choices, fake: json.fake === true };
}

/** The voice in force for a language: the one chosen, if it is still in the catalogue (and of the workspace's gender), else the default of that gender. */
export function inForce(picker: Picker, language: PickerLang): PickerVoice | null {
  const mine = picker.voices.filter((v) => v.language === language && v.gender === picker.gender);
  return mine.find((v) => v.id === picker.choices[language]) ?? mine.find((v) => v.isDefault) ?? null;
}

/** The catalogue as the test screens (VOICE_PICKER_SCREENS=mock) show it before C1's v2 endpoint is live: every language has voices of both genders, a default of each gender and two or three "Recommended". */
const V = (id: string, language: PickerLang, name: string, gender: Gender, tags: string[], o: { isDefault?: boolean; recommended?: boolean } = {}): PickerVoice => ({ id, language, name, label: tags[0] ?? "", tags, gender, isDefault: o.isDefault === true, recommended: o.recommended === true, sampleUrl: `/mock/${id}`, sampleText: null });
export const MOCK_VOICES: readonly PickerVoice[] = [
  V("te-ramya", "te", "Ramya", "female", ["warm", "mature"], { isDefault: true, recommended: true }),
  V("te-sindhu", "te", "Sindhu", "female", ["bright", "young"], { recommended: true }),
  V("te-kiran", "te", "Kiran", "male", ["deep", "calm"], { isDefault: true, recommended: true }),
  V("te-arjun", "te", "Arjun", "male", ["energetic", "young"]),
  V("en-janvi", "en", "Janvi", "female", ["calm", "warm"], { isDefault: true, recommended: true }),
  V("en-riya", "en", "Riya", "female", ["bright", "energetic"]),
  V("en-dev", "en", "Dev", "male", ["deep", "mature"], { isDefault: true, recommended: true }),
  V("hi-sanya", "hi", "Sanya", "female", ["calm", "mature"], { isDefault: true, recommended: true }),
  V("hi-esha", "hi", "Esha", "female", ["warm", "young"], { recommended: true }),
  V("hi-rohan", "hi", "Rohan", "male", ["deep", "calm"], { isDefault: true, recommended: true }),
  V("kn-disha", "kn", "Disha", "female", ["warm", "calm"], { isDefault: true, recommended: true }),
  V("kn-divya", "kn", "Divya", "female", ["bright", "young"]),
  V("kn-prakash", "kn", "Prakash", "male", ["deep", "mature"], { isDefault: true, recommended: true }),
  V("ta-meena", "ta", "Meena", "female", ["warm", "mature"], { isDefault: true, recommended: true }),
  V("ta-vijay", "ta", "Vijay", "male", ["calm", "deep"], { isDefault: true, recommended: true }),
  V("ml-anjali", "ml", "Anjali", "female", ["calm", "warm"], { isDefault: true, recommended: true }),
  V("ml-arun", "ml", "Arun", "male", ["deep", "calm"], { isDefault: true, recommended: true }),
];
