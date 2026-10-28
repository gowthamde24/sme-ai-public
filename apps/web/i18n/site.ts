import site from "@/i18n/strings/site.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor, namedDict } from "@/i18n/strings";

/**
 * The public website's words for one language (job CM): the home page, pricing, how it works, security, contact, help and the calculator. SERVER ONLY, like landing.ts: all four dictionaries would land in the browser
 * bundle if a client component imported this file, so the server passes the few strings a client island needs as props (a test enforces it). The words of each business type's own page are in packages/packs
 * (landing.json), not here.
 */
export type SiteKey = keyof typeof site;
export type SiteDict = Record<SiteKey, string>;
export type SiteT = (key: SiteKey, vars?: Vars) => string;

const cache = new Map<string, SiteDict>();

/**
 * The public site names no assistant (owner, 28 Oct: no fixed name; the owner sets the name in the app): wherever its words say `{assistant}` the visitor reads "your assistant" in their language. At the start of an English sentence it is capitalised.
 * (A workspace's own name is for the app, lib/assistant/name.ts.) The Hindi word is the feminine "असिस्टेंट" the verbs of these strings were written for.
 */
export const SITE_ASSISTANT: Record<Lang, string> = { en: "your assistant", te: "మీ అసిస్టెంట్", hi: "आपकी असिस्टेंट", kn: "ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್" };
export function withSiteAssistant(text: string, lang: Lang): string {
  if (!text.includes("{assistant}")) return text;
  const name = SITE_ASSISTANT[lang];
  return text.replace(/\{assistant\}/g, (_m, at: number) => (lang === "en" && (at === 0 || /([.!?]\s+|["“])$/.test(text.slice(0, at))) ? `${name[0].toUpperCase()}${name.slice(1)}` : name));
}

export function siteDict(lang: Lang): SiteDict {
  return namedDict<SiteDict>(cache, lang, () => Object.fromEntries(Object.entries(dictFor(site, lang)).map(([k, v]) => [k, withSiteAssistant(v as string, lang)])) as SiteDict);
}

export function siteT(lang: Lang): SiteT {
  const dict = siteDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
