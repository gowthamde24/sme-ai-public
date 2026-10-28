import type { CallLang } from "@/lib/assistant/types";

/**
 * The voice picker (owner decision 28 Oct, job-voice-picker.md; Settings > AI assistant > Voice): the catalogue of approved voices, and the voice the workspace chose for each language (none = the default of that language). The shapes the screen reads;
 * every answer is checked (lib/api/voice-picker.ts has the contract this assumes until C1's endpoint is on main). A sample is a short recording made ONCE for each voice and kept as a file: the browser plays it through this app's own route.
 */
export const PICKER_LANGS = ["en", "te", "hi", "kn"] as const satisfies readonly CallLang[];
export type PickerLang = (typeof PICKER_LANGS)[number];
export const GENDERS = ["female", "male"] as const;
export type Gender = (typeof GENDERS)[number];
export const VOICE_ID = /^[a-z0-9][a-z0-9_.-]{1,59}$/;

export type PickerVoice = {
  id: string;
  language: PickerLang;
  /** The voice's first name ("Janvi"). */
  name: string;
  /** A short label in plain words ("Calm", "Cheerful", "Male"), as the catalogue says it. */
  label: string;
  gender: Gender;
  isDefault: boolean;
  /** A path on the API of the pre-rendered sample, or null when there is none yet. The browser never gets it: it asks this app's route. */
  sampleUrl: string | null;
};
export type Choices = Partial<Record<PickerLang, string | null>>;
export type Picker = { voices: PickerVoice[]; choices: Choices; fake: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPickerLang = (l: unknown): l is PickerLang => (PICKER_LANGS as readonly unknown[]).includes(l);

/** The path of a sample: on the API (a plain path that starts with a slash, no host, no way up and out), or nothing. */
export const safeSamplePath = (v: unknown): string | null => (typeof v === "string" && /^\/[A-Za-z0-9_\-./]{1,200}(\?[A-Za-z0-9_\-.=&]{1,100})?$/.test(v) && !v.includes("..") && !v.startsWith("//") ? v : null);

export function parsePicker(json: unknown): Picker | null {
  if (!isRecord(json) || !Array.isArray(json.voices) || !isRecord(json.choices)) return null;
  const voices: PickerVoice[] = [];
  for (const r of json.voices) {
    if (!isRecord(r) || typeof r.id !== "string" || !VOICE_ID.test(r.id) || typeof r.name !== "string" || r.name.length < 1 || r.name.length > 40 || typeof r.label !== "string" || r.label.length > 30 || typeof r.default !== "boolean") return null;
    if (!(GENDERS as readonly unknown[]).includes(r.gender)) return null;
    if (typeof r.language !== "string") return null;
    if (!isPickerLang(r.language)) continue; // a language the picker has no row for is left out
    voices.push({ id: r.id, language: r.language, name: r.name, label: r.label, gender: r.gender as Gender, isDefault: r.default, sampleUrl: r.sample_url === null || r.sample_url === undefined ? null : safeSamplePath(r.sample_url) });
  }
  const choices: Choices = {};
  for (const l of PICKER_LANGS) {
    const c = json.choices[l];
    if (c === undefined || c === null) continue;
    if (typeof c !== "string" || !VOICE_ID.test(c)) return null;
    choices[l] = c;
  }
  return { voices, choices, fake: json.fake === true };
}

/** The voice in force for a language: the one chosen, if it is still in the catalogue, else the default. */
export function inForce(picker: Picker, language: PickerLang): PickerVoice | null {
  const mine = picker.voices.filter((v) => v.language === language);
  return mine.find((v) => v.id === picker.choices[language]) ?? mine.find((v) => v.isDefault) ?? null;
}

/** The approved catalogue of 28 Oct, as the test screens (VOICE_PICKER_SCREENS=mock) show it before C1's endpoint is live. */
const V = (id: string, language: PickerLang, name: string, label: string, gender: Gender, isDefault = false): PickerVoice => ({ id, language, name, label, gender, isDefault, sampleUrl: `/mock/${id}` });
export const MOCK_VOICES: readonly PickerVoice[] = [
  V("cartesia_en_janvi", "en", "Janvi", "Calm", "female", true),
  V("cartesia_te_ramya", "te", "Ramya", "Calm", "female", true),
  V("cartesia_hi_sanya", "hi", "Sanya", "Calm", "female", true),
  V("cartesia_hi_esha", "hi", "Esha", "Cheerful", "female"),
  V("cartesia_hi_meera", "hi", "Meera", "Warm", "female"),
  V("cartesia_kn_disha", "kn", "Disha", "Calm", "female", true),
  V("cartesia_kn_divya", "kn", "Divya", "Cheerful", "female"),
  V("cartesia_kn_prakash", "kn", "Prakash", "Male", "male"),
];
