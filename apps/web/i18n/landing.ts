import landing from "@/i18n/strings/landing.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor } from "@/i18n/strings";

/**
 * The landing page's words for one language, built from the string store. SERVER ONLY: a client component must not
 * import this file (all four dictionaries would land in the browser bundle); the server passes the few strings a client
 * island needs as props. A test enforces it.
 */
export type LandingKey = keyof typeof landing;
export type LandingDict = Record<LandingKey, string>;
export type LandingT = (key: LandingKey, vars?: Vars) => string;

const cache: Partial<Record<Lang, LandingDict>> = {};

export function landingDict(lang: Lang): LandingDict {
  return (cache[lang] ??= dictFor(landing, lang) as LandingDict);
}

export function landingT(lang: Lang): LandingT {
  const dict = landingDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
