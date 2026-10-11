import legal from "@/i18n/strings/legal.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor } from "@/i18n/strings";

/**
 * The words around the legal pages and the cookie notice (job BH): the summaries, the notice, the cookie settings, the footer links. The legal TEXTS themselves (lib/legal/*-text.ts) stay in English and are
 * never translated by machine; the summaries and the notice are machine drafts in Telugu, Hindi and Kannada, and the draft banner is English in every language (`humanOnly`).
 * SERVER ONLY, like landing.ts: a client component must not import this file (all four dictionaries would land in the browser); the server resolves the words a client island needs and passes them as props.
 */
export type LegalKey = keyof typeof legal;
export type LegalT = (key: LegalKey, vars?: Vars) => string;

const cache: Partial<Record<Lang, Record<LegalKey, string>>> = {};

export function legalDict(lang: Lang): Record<LegalKey, string> {
  return (cache[lang] ??= dictFor(legal as never, lang) as Record<LegalKey, string>);
}

export function legalT(lang: Lang): LegalT {
  const dict = legalDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
