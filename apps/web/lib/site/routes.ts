import type { SiteLang } from "@/i18n/lang";
import { SITE_LANGS } from "@/i18n/site-lang";

import { isSitePage, SITE_PAGES, type SiteTarget } from "./paths";
import { HELP_ARTICLES, isArticleSlug } from "@/lib/public/data";
import { SITE_PACKS, packBySlug } from "./packs";

/** What an address means: the language and the page, or null when it is neither (a 404). SERVER ONLY (it knows the business types). One to three segments (a page, or a help article: "/te/help/<slug>"); "en" is not a prefix (English is unprefixed). */
const isLang = (v: string): v is SiteLang => (SITE_LANGS as readonly string[]).includes(v);

export function resolveSite(segments: readonly string[]): { lang: SiteLang; target: SiteTarget } | null {
  if (segments.length === 0) return { lang: "en", target: { kind: "home" } };
  if (segments.length > 3) return null;
  const [first, ...rest] = segments;
  if (first !== "en" && isLang(first)) {
    if (rest.length === 0) return { lang: first, target: { kind: "home" } };
    const t = targetOf(rest);
    return t ? { lang: first, target: t } : null;
  }
  const t = targetOf(segments);
  return t ? { lang: "en", target: t } : null;
}

function targetOf(segs: readonly string[]): SiteTarget | null {
  const [seg, slug] = segs;
  if (segs.length === 2) return seg === "help" && isArticleSlug(slug) ? { kind: "article", slug } : null;
  if (segs.length !== 1) return null;
  if (isSitePage(seg)) return { kind: "page", page: seg };
  return packBySlug(seg) ? { kind: "pack", slug: seg } : null;
}

/** Every address of the site, in every language (the sitemap and the language alternates). */
export function allTargets(): SiteTarget[] {
  return [{ kind: "home" }, ...SITE_PAGES.map((page): SiteTarget => ({ kind: "page", page })), ...HELP_ARTICLES.map((a): SiteTarget => ({ kind: "article", slug: a.slug })), ...SITE_PACKS.map((p): SiteTarget => ({ kind: "pack", slug: p.slug }))];
}
