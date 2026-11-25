import pub from "@/i18n/strings/public.json";

import { fill, type Vars } from "@/i18n/fill";
import type { SiteLang } from "@/i18n/lang";
import { dictFor, namedDict } from "@/i18n/strings";

/**
 * The words of the public pages added for launch (29 Nov 2026): the new pricing page, the help center and its ten articles, status, acceptable use, refunds and Talk to us. SERVER ONLY, like site.ts: the server passes the few
 * words a client island needs (the help search, the Talk to us form) as props. English is the source; Telugu, Hindi and Kannada are machine-written drafts (the status is in the JSON), Tamil shows the English.
 */
export type PubKey = keyof typeof pub;
export type PubDict = Record<PubKey, string>;
export type PubT = (key: PubKey, vars?: Vars) => string;

const cache = new Map<string, PubDict>();

export function pubDict(lang: SiteLang): PubDict {
  return namedDict<PubDict>(cache, lang, () => dictFor(pub, lang) as Record<string, string>);
}

export function pubT(lang: SiteLang): PubT {
  const dict = pubDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
