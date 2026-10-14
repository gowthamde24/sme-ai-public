import type { Lang } from "@/i18n/lang";
import { LANGS } from "@/i18n/lang";

import { isSitePage, SITE_PAGES, type SiteTarget } from "./paths";
import { SITE_PACKS, packBySlug } from "./packs";

/** What an address means: the language and the page, or null when it is neither (a 404). SERVER ONLY (it knows the business types). One or two segments; "en" is not a prefix (English is unprefixed). */
const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);

export function resolveSite(segments: readonly string[]): { lang: Lang; target: SiteTarget } | null {
  if (segments.length === 0) return { lang: "en", target: { kind: "home" } };
  if (segments.length > 2) return null;
  const [first, second] = segments;
  if (first !== "en" && isLang(first)) {
    if (second === undefined) return { lang: first, target: { kind: "home" } };
    const t = targetOf(second);
    return t ? { lang: first, target: t } : null;
  }
  if (second !== undefined) return null;
  const t = targetOf(first);
  return t ? { lang: "en", target: t } : null;
}

function targetOf(seg: string): SiteTarget | null {
  if (isSitePage(seg)) return { kind: "page", page: seg };
  return packBySlug(seg) ? { kind: "pack", slug: seg } : null;
}

/** Every address of the site, in every language (the sitemap and the language alternates). */
export function allTargets(): SiteTarget[] {
  return [{ kind: "home" }, ...SITE_PAGES.map((page): SiteTarget => ({ kind: "page", page })), ...SITE_PACKS.map((p): SiteTarget => ({ kind: "pack", slug: p.slug }))];
}
