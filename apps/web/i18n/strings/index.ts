import type { Lang } from "@/i18n/lang";
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

type Raw = Record<string, { en: string; te: string; hi: string; kn: string }>;

/**
 * A browser may break a line right after a hyphen, which splits a word like फ़ॉलो-अप ("follow-up") into
 * "फ़ॉलो-" and "अप". In Telugu, Hindi and Kannada a WORD JOINER (U+2060, invisible) after a hyphen between two
 * letters forbids that break, at every width. English is left alone.
 */
const NO_BREAK_AFTER_HYPHEN = /([\p{L}\p{M}])-(?=[\p{L}\p{M}])/gu;
export const keepHyphenatedWordsWhole = (text: string): string => text.replace(NO_BREAK_AFTER_HYPHEN, "$1-\u2060");

/**
 * A dictionary built once per language AND assistant name (job DN): every `{assistant}` in it is already the name of the workspace being drawn, so `wordsFor`, `frameLabels` and the words passed to client parts need no
 * further step. The store keeps a few entries only (the default name and the names in use now); it is cleared when it grows, so a long-running server cannot fill up with names.
 */
export function namedDict<D>(store: Map<string, D>, lang: Lang, build: () => Record<string, string>): D {
  const name = currentAssistantName();
  const key = `${lang}|${name}`;
  let dict = store.get(key);
  if (!dict) {
    if (store.size >= 40) store.clear();
    dict = Object.fromEntries(Object.entries(build()).map(([k, v]) => [k, withTrialDays(withNamedAssistant(v, name, lang))])) as D;
    store.set(key, dict);
  }
  return dict;
}

/** One flat key -> text dictionary for a language, typed by the keys of the JSON file. */
export function dictFor<T extends Raw>(data: T, lang: Lang): { [K in keyof T]: string } {
  const out = {} as { [K in keyof T]: string };
  for (const k of Object.keys(data) as (keyof T)[]) out[k] = lang === "en" ? data[k][lang] : keepHyphenatedWordsWhole(data[k][lang]);
  return out;
}
