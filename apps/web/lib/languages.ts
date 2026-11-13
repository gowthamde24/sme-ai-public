import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * ONE list of languages for every picker (owner, 13 Nov 2026): the four launch languages, in this order. Tamil, Malayalam and Marathi are offered only when MORE_LANGUAGES is on (lib/screens/flag.ts), and a language a person already uses
 * (a saved greeting, the current choice) stays visible whatever the flag says, so nothing saved is hidden. Pure: no fetch, no React, no flag read; the page reads the flag and passes the list down.
 */
export const LAUNCH_LANGS = ["en", "te", "hi", "kn"] as const satisfies readonly CallLang[];

export function offeredLangs(more: boolean): readonly CallLang[] {
  return more ? [...LAUNCH_LANGS, ...CALL_LANGS.filter((l) => !(LAUNCH_LANGS as readonly string[]).includes(l))] : LAUNCH_LANGS;
}

/** The offered list plus the languages in use (the ones that are not offered follow the offered ones, in the list's own order). */
export function withKept(offered: readonly CallLang[], ...keep: readonly (string | null | undefined)[]): readonly CallLang[] {
  const extra = CALL_LANGS.filter((l) => !offered.includes(l) && keep.includes(l));
  return extra.length === 0 ? offered : [...offered, ...extra];
}
