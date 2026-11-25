import { introduceProblem, introduceToApi, parseIntroduceAs, type IntroduceAs } from "./introduce";

/**
 * "How your assistant speaks" (owner decision 11 Nov 2026; C1's FIXED contract docs/contracts/how-assistant-speaks.md, PR #459: the endpoint `GET/PUT /how-assistant-speaks` is built after it, until then the panel runs on a mock made from the contract). One object for Tone, Words per
 * language, and Introduce as (and, since 21 Nov, the background and "Say AI assistant when greeting"). Casual is NOT an option here (the owner's own test call only); Formal is hidden. Pure: no fetch, no React.
 */
export const TONES = ["friendly", "respectful", "quick", "professional", "calm_caring", "cheerful", "confident"] as const; // the 7 speaking styles (C1's voice-styles.md section 1); the first three are the ones that always existed
/** The three styles that always existed: the older panels (How your assistant speaks) offer these only. */
export const BASE_TONES = ["friendly", "respectful", "quick"] as const;
/** The three styles that have a prepared sample call; each of the four newer ones speaks on top of one of them (C1: professional on respectful, the others on friendly). */
export const BASE_TONE: Readonly<Record<SpeakTone, "friendly" | "respectful" | "quick">> = { friendly: "friendly", respectful: "respectful", quick: "quick", professional: "respectful", calm_caring: "friendly", cheerful: "friendly", confident: "friendly" };
/** A speaking style as the API lists it: its words per language (drafts until reviewed) and the kinds of business it suits. */
export type ToneOption = { id: SpeakTone; label: Partial<Record<string, string>>; hint: Partial<Record<string, string>>; bestFor: string[] };
export type SpeakTone = (typeof TONES)[number];
export const STYLES = ["everyday_mixed", "everyday_pure"] as const; // "formal" is not offered; one saved earlier is shown as everyday_pure (the API does this)
export type SpeakStyle = (typeof STYLES)[number];
/** The languages the panel shows Words for (Tamil; Malayalam and Marathi are paused, owner 9 Nov). There is NO Region any more (C1, 21 Nov 2026: docs/contracts/voices-tones.md section 4): the API neither returns nor reads it. */
export const SPEAK_LANGS = ["te", "kn", "hi", "ta"] as const;
export type SpeakLang = (typeof SPEAK_LANGS)[number];
/** The very quiet sound under the assistant's voice on a call (voices-tones.md section 6); `quiet_office` is the default. */
export const BACKGROUNDS = ["off", "quiet_office", "busy_office", "call_centre", "shop", "market", "showroom", "clinic_reception", "home", "street"] as const;
export type Background = (typeof BACKGROUNDS)[number];
export type BackgroundState = { value: Background; saved: boolean; /** the words of each choice as the API says them, per language (en, te, hi, kn, ...) */ options: { id: Background; label: Partial<Record<string, string>>; /** the API path of its 6-second preview (null for Off) */ sampleUrl: string | null }[] };
/** "Say 'AI assistant' when greeting" (greeting-disclosure.md): false until the owner turns it on; `saved` = the owner chose. */
/** `undertakingAt`: when the Owner accepted the written undertaking that lets the greeting stay off (null while it is on). */
export type SayAiState = { value: boolean; saved: boolean; undertakingAt: string | null };
export const EXAMPLE_LANGS = ["te", "kn", "hi", "en"] as const;
export type ExampleLang = (typeof EXAMPLE_LANGS)[number];
export type ToneSource = "saved" | "migrated" | "pack_default";
export type LegacyAddress = "plain" | "sir_madam" | "garu" | "ji";

export type LangStyle = { style: SpeakStyle; saved: boolean; examples: "approved" | "draft" };
export type HowSpeaks = {
  tone: { value: SpeakTone; source: ToneSource; packDefault: SpeakTone; /** the styles the API lists (7); empty from an older API: the three that always existed are drawn */ options: ToneOption[] };
  /** null = this API has no background yet (nothing is drawn) */
  background: BackgroundState | null;
  /** null = this API has no such setting yet (no switch is drawn: never a switch that does nothing) */
  sayAi: SayAiState | null;
  words: Record<SpeakLang, LangStyle>;
  introduceAs: IntroduceAs & { ownerName: string | null };
  packDefaults: { tone: SpeakTone };
  legacyAddress: LegacyAddress | null;
  updatedAt: string | null;
};
/** What the Owner changes: any subset (a key left out is not changed). `tone: null` resets to the business type's usual. */
export type SpeaksChange = { tone?: SpeakTone | null; words?: Partial<Record<SpeakLang, { style?: SpeakStyle }>>; introduceAs?: IntroduceAs; background?: Background | null; sayAi?: boolean | null; /** Needed with `sayAi: false`: the Owner accepted the written undertaking (the API keeps the date and who). */ sayAiUndertaking?: true };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const one = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);

/** The API's answer, field by field (an odd answer is null, never a guess). `formal` (a workspace that saved it earlier) is read as everyday_pure, as the contract says. */
export function parseHowSpeaks(raw: unknown): HowSpeaks | null {
  if (!isRec(raw) || !isRec(raw.tone) || !isRec(raw.words) || !isRec(raw.words.languages) || !isRec(raw.introduce_as)) return null;
  const tone = one(TONES, raw.tone.value);
  const packDefault = one(TONES, raw.tone.pack_default);
  const source = one(["saved", "migrated", "pack_default"] as const, raw.tone.source);
  if (!tone || !packDefault || !source) return null;
  const words = {} as Record<SpeakLang, LangStyle>;
  for (const l of SPEAK_LANGS) {
    const e = raw.words.languages[l];
    if (!isRec(e)) return null;
    const style: SpeakStyle = e.style === "everyday_mixed" ? "everyday_mixed" : "everyday_pure";
    words[l] = { style, saved: e.saved === true, examples: e.examples === "approved" ? "approved" : "draft" };
  }
  const ia = parseIntroduceAs({ kind: raw.introduce_as.kind, text: raw.introduce_as.text ?? null });
  if (!ia) return null;
  const ownerName = typeof raw.introduce_as.owner_name === "string" && raw.introduce_as.owner_name.trim() !== "" ? raw.introduce_as.owner_name.trim().slice(0, 40) : null;
  const pd = isRec(raw.pack_defaults) ? one(TONES, raw.pack_defaults.tone) : null;
  return {
    tone: { value: tone, source, packDefault, options: parseToneOptions(raw.tone.options) },
    background: parseBackground(raw.background),
    sayAi: parseSayAi(raw.say_ai_when_greeting),
    words,
    introduceAs: { ...ia, ownerName },
    packDefaults: { tone: pd ?? packDefault },
    legacyAddress: one(["plain", "sir_madam", "garu", "ji"] as const, raw.legacy_address),
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

const words = (raw: unknown, max: number): Partial<Record<string, string>> => {
  const out: Partial<Record<string, string>> = {};
  if (isRec(raw)) for (const [lang, text] of Object.entries(raw).slice(0, 12)) if (/^[a-z]{2}$/.test(lang) && typeof text === "string" && text.trim() !== "" && text.length <= max) out[lang] = text.trim();
  return out;
};
/** `tone.options`: from this stage of the API the entries are objects `{id, label{}, hint{}, best_for[], reviewed}`; the older strings (or anything odd) give an empty list: the three styles the web has always known are drawn. */
export function parseToneOptions(raw: unknown): ToneOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ToneOption[] = [];
  for (const o of raw.slice(0, 12)) {
    const id = isRec(o) ? one(TONES, o.id) : null;
    if (!id || !isRec(o) || out.some((x) => x.id === id)) continue;
    const label = words(o.label, 40);
    if (!label.en) continue;
    out.push({ id, label, hint: words(o.hint, 80), bestFor: Array.isArray(o.best_for) ? o.best_for.filter((b): b is string => typeof b === "string" && /^[a-z_]{2,20}$/.test(b)).slice(0, 8) : [] });
  }
  return out;
}

/** `background {value, saved, options: [{id, label: {en, te, ...}}]}`; absent or odd = null (an older API: no choice is drawn). */
export function parseBackground(raw: unknown): BackgroundState | null {
  if (!isRec(raw)) return null;
  const value = one(BACKGROUNDS, raw.value);
  if (!value || !Array.isArray(raw.options)) return null;
  const options: BackgroundState["options"] = [];
  for (const o of raw.options.slice(0, 12)) {
    const id = isRec(o) ? one(BACKGROUNDS, o.id) : null;
    if (!id || !isRec(o) || !isRec(o.label) || options.some((x) => x.id === id)) continue;
    const label: Partial<Record<string, string>> = {};
    for (const [lang, text] of Object.entries(o.label).slice(0, 12)) if (/^[a-z]{2}$/.test(lang) && typeof text === "string" && text.trim() !== "" && text.length <= 40) label[lang] = text.trim();
    if (label.en) options.push({ id, label, sampleUrl: typeof o.sample_url === "string" && /^\/v1\/background-samples\/[a-z_]+\.mp3$/.test(o.sample_url) ? o.sample_url : null });
  }
  return options.length > 0 ? { value, saved: raw.saved === true, options } : null;
}

/** `say_ai_when_greeting {value, saved}`: absent = the API does not have it (null: no switch is drawn). */
export function parseSayAi(raw: unknown): SayAiState | null {
  return isRec(raw) && typeof raw.value === "boolean" ? { value: raw.value, saved: raw.saved === true, undertakingAt: typeof raw.undertaking_accepted_at === "string" ? raw.undertaking_accepted_at.slice(0, 40) : null } : null;
}

/** The contract's migration of the old "How to address customers": plain (never chosen) = the business type's usual; sir_madam, garu and ji = Respectful. Used by the mock; the API does it for real. */
export const toneFromLegacy = (address: LegacyAddress | null, packDefault: SpeakTone): SpeakTone => (address === "sir_madam" || address === "garu" || address === "ji" ? "respectful" : packDefault);

export type SpeaksProblem = "tone" | "language" | "style" | "introduce" | "background" | "say_ai" | "say_ai_undertaking" | "empty";
/** The browser's change, checked again on the server with the contract's rules; the problem is a closed word, never the API's text. */
export function speaksProblem(c: unknown): SpeaksProblem | null {
  if (!isRec(c)) return "empty";
  const keys = Object.keys(c);
  if (keys.length === 0 || keys.some((k) => !["tone", "words", "introduceAs", "background", "sayAi", "sayAiUndertaking"].includes(k))) return "empty";
  if (c.tone !== undefined && c.tone !== null && one(TONES, c.tone) === null) return "tone";
  if (c.words !== undefined) {
    if (!isRec(c.words) || Object.keys(c.words).length === 0) return "language";
    for (const [l, v] of Object.entries(c.words)) {
      if (!(SPEAK_LANGS as readonly string[]).includes(l) || !isRec(v) || Object.keys(v).length === 0 || Object.keys(v).some((k) => k !== "style")) return "language";
      if (v.style !== undefined && one(STYLES, v.style) === null) return "style";
    }
  }
  if (c.background !== undefined && c.background !== null && one(BACKGROUNDS, c.background) === null) return "background";
  if (c.sayAi !== undefined && c.sayAi !== null && typeof c.sayAi !== "boolean") return "say_ai";
  if (c.sayAiUndertaking !== undefined && c.sayAiUndertaking !== true) return "say_ai";
  if (c.sayAi === false && c.sayAiUndertaking !== true) return "say_ai_undertaking"; // switching the greeting off needs the written undertaking (lawyer's opinion, 25 Nov 2026)
  if (c.introduceAs !== undefined) {
    const ia = parseIntroduceAs(c.introduceAs);
    if (!ia || introduceProblem(ia) !== null) return "introduce";
  }
  return null;
}

/** The PUT body (the contract's own words). */
export function speaksToApi(c: SpeaksChange): Record<string, unknown> {
  return {
    ...(c.tone !== undefined ? { tone: c.tone } : {}),
    ...(c.words ? { words: c.words } : {}),
    ...(c.introduceAs ? { introduce_as: introduceToApi(c.introduceAs) } : {}),
    ...(c.background !== undefined ? { background: c.background } : {}),
    ...(c.sayAi !== undefined ? { say_ai_when_greeting: c.sayAi } : {}),
    ...(c.sayAiUndertaking ? { say_ai_undertaking: { accepted: true } } : {}),
  };
}
