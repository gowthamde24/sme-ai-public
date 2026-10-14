import { fillPlain } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";

import bundle from "./site-packs.generated.json";
import type { OwlId, SitePack, Text } from "./types";

/**
 * The business types that have a public page (job CM): read from the generated bundle, which `make site-packs` builds from the pack files (pack.json + landing.json). SERVER ONLY (it holds four languages of
 * every page; a test keeps it out of client components). No business type is named here or anywhere in the site's code: the pages, the home page's cards and the sitemap come from this list, so a new landing.json is
 * a new page with no code.
 */
const DATA = bundle as unknown as { packs: readonly SitePack[] };

export const SITE_PACKS: readonly SitePack[] = DATA.packs;

export function packBySlug(slug: string): SitePack | null {
  return SITE_PACKS.find((p) => p.slug === slug) ?? null;
}

/** A text in one language, English when the language has none. */
export function textIn(text: Text | undefined, lang: Lang): string {
  if (!text) return "";
  return (lang === "en" ? text.en : text[lang]) || text.en;
}

/** `textIn` with {brand} filled for running text in a page. */
export const say = (text: Text | undefined, lang: Lang): string => fillPlain(textIn(text, lang));

/** The owl's name in this business type's own words (Fee Desk, Site Measurer), English when the pack has none. */
export function owlName(pack: SitePack, owl: OwlId, lang: Lang): string | null {
  const t = pack.agents[owl];
  return t ? textIn(t, lang) : null;
}
