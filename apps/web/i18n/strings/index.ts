import type { SiteLang } from "@/i18n/lang";
import { withNamedAssistant } from "@/lib/assistant/default-name";
import { currentAssistantName } from "@/lib/assistant/name";
import { withTrialDays } from "@/lib/plan/trial-days";

/**
 * The master string store. Every translated string lives in one JSON file per area
 * (src/i18n/strings/{landing,login,app,voice,fixtures}.json) as
 *   { "<key>": { en, te, hi, kn, status: { te, hi, kn }, only?: [...] } }
 * English is the source. `status` is "draft" (machine-written, not yet read by a person who speaks the
 * language) or "reviewed" (the owner's choice is in). `only` lists the languages a string really exists
 * in, for text that is the same in every dictionary (a Telugu sample message, the copyright line).
 * The TS dictionaries are built from these files; `npm run i18n:status` counts the drafts.
 */
export type Status = "draft" | "reviewed";
export type TranslatedLang = "te" | "hi" | "kn";
export const TRANSLATED_LANGS: readonly TranslatedLang[] = ["te", "hi", "kn"];

/** `ta` (Tamil) exists in the public site's words only (job: Tamil on the site); a key without it shows its English. */
type Raw = Record<string, { en: string; te: string; hi: string; kn: string; ta?: string; status?: Partial<Record<TranslatedLang | "ta", string>> }>;

/**
 * A browser may break a line right after a hyphen, which splits a word like फ़ॉलो-अप ("follow-up") into
 * "फ़ॉलो-" and "अप". In Telugu, Hindi and Kannada a WORD JOINER (U+2060, invisible) after a hyphen between two
 * letters forbids that break, at every width. English is left alone.
 */
const NO_BREAK_AFTER_HYPHEN = /([\p{L}\p{M}])-(?=[\p{L}\p{M}])/gu;
export const keepHyphenatedWordsWhole = (text: string): string => text.replace(NO_BREAK_AFTER_HYPHEN, "$1-\u2060");

/**
 * A dictionary built once per language AND assistant name (job DN): every `{assistant}` in it is already the name of the workspace being drawn, so `wordsFor`, `frameLabels` and the words passed to client parts need no
 * further step (`source`: the JSON the dictionary is built from, so reviewed-only mode can tell an English fallback from a reviewed string). The store keeps a few entries only (the default name and the names in use now); it is cleared when it grows, so a long-running server cannot fill up with names.
 */
export function namedDict<D>(store: Map<string, D>, lang: SiteLang, build: () => Record<string, string>, source?: Raw): D {
  const name = currentAssistantName();
  const key = `${lang}|${name}`;
  let dict = store.get(key);
  if (!dict) {
    if (store.size >= 40) store.clear();
    // reviewed-only mode: a string that shows its English (not reviewed in this language) keeps the English word for the default assistant too, so "{assistant} proposed a visit" never reads "మీ అసిస్టెంట్ proposed a visit"
    const strict = source !== undefined && lang !== "en" && reviewedOnly();
    const langOf = (k: string): SiteLang => (strict && source[k] !== undefined && source[k].status?.[lang as TranslatedLang | "ta"] !== "reviewed" ? "en" : lang);
    dict = Object.fromEntries(Object.entries(build()).map(([k, v]) => [k, withTrialDays(withNamedAssistant(v, name, langOf(k)))])) as D;
    store.set(key, dict);
  }
  return dict;
}

/** One flat key -> text dictionary for a language, typed by the keys of the JSON file. */
export function dictFor<T extends Raw>(data: T, lang: SiteLang): { [K in keyof T]: string } {
  const out = {} as { [K in keyof T]: string };
  const strict = lang !== "en" && reviewedOnly();
  for (const k of Object.keys(data) as (keyof T)[]) {
    // reviewed-only mode (Customer Zero): a Telugu, Hindi or Kannada string nobody who reads the language has approved shows the English instead (never a machine draft, never a bare key)
    // a Tamil text exists only where the site has one (the app's dictionaries have none): without it, and in reviewed-only mode while it is a draft, the English shows
    if (lang === "en" || (strict && data[k].status?.[lang] !== "reviewed")) out[k] = data[k].en;
    else out[k] = keepHyphenatedWordsWhole(data[k][lang] ?? data[k].en);
  }
  return out;
}

/** `REVIEWED_TRANSLATIONS_ONLY=1`: only strings a person who reads the language has reviewed are shown in Telugu, Hindi or Kannada; every other string shows its English. Off by default (staging and the demo show the drafts so they can be read and corrected). */
export function reviewedOnly(): boolean {
  return process.env.REVIEWED_TRANSLATIONS_ONLY === "1";
}
