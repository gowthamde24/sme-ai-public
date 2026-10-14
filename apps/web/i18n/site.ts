import site from "@/i18n/strings/site.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor } from "@/i18n/strings";

/**
 * The public website's words for one language (job CM): the home page, pricing, how it works, security, contact, help and the calculator. SERVER ONLY, like landing.ts: all four dictionaries would land in the browser
 * bundle if a client component imported this file, so the server passes the few strings a client island needs as props (a test enforces it). The words of each business type's own page are in packages/packs
 * (landing.json), not here.
 */
export type SiteKey = keyof typeof site;
export type SiteDict = Record<SiteKey, string>;
export type SiteT = (key: SiteKey, vars?: Vars) => string;

const cache: Partial<Record<Lang, SiteDict>> = {};

export function siteDict(lang: Lang): SiteDict {
  return (cache[lang] ??= dictFor(site, lang) as SiteDict);
}

export function siteT(lang: Lang): SiteT {
  const dict = siteDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
