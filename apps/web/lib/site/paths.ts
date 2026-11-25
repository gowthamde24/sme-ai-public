import type { SiteLang } from "@/i18n/lang";

/**
 * The addresses of the public site (job CM). English has no prefix ("/pricing"), Telugu, Hindi, Kannada and Tamil have one ("/te/pricing", "/ta/pricing"), so a link can be shared and a search engine can tell the languages apart. A page is the
 * home page, one of the fixed pages below, or the page of a business type (its `slug` from landing.json). Pure and small: a client component may import this file (routes.ts, which knows the business types, may not).
 */
export const SITE_PAGES = ["pricing", "how-it-works", "security", "contact", "help", "status", "acceptable-use", "refunds", "talk-to-us"] as const;
export type SitePage = (typeof SITE_PAGES)[number];
/** `article`: one help article, "/help/<slug>" ("/te/help/<slug>"); its slugs are in lib/public/data.ts. */
export type SiteTarget = { kind: "home" } | { kind: "page"; page: SitePage } | { kind: "pack"; slug: string } | { kind: "article"; slug: string };

export const isSitePage = (v: string): v is SitePage => (SITE_PAGES as readonly string[]).includes(v);

const segment = (t: SiteTarget): string => (t.kind === "home" ? "" : t.kind === "page" ? t.page : t.kind === "article" ? `help/${t.slug}` : t.slug);

/** "/", "/te", "/pricing", "/te/pricing", "/construction", "/hi/construction". */
export function sitePath(lang: SiteLang, target: SiteTarget): string {
  const seg = segment(target);
  const prefix = lang === "en" ? "" : `/${lang}`;
  return seg === "" ? prefix || "/" : `${prefix}/${seg}`;
}
