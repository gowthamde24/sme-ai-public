import type { SiteLang } from "@/i18n/lang";

/**
 * The addresses of the public site (job CM). English has no prefix ("/pricing"), Telugu, Hindi, Kannada and Tamil have one ("/te/pricing", "/ta/pricing"), so a link can be shared and a search engine can tell the languages apart. A page is the
 * home page, one of the fixed pages below, or the page of a business type (its `slug` from landing.json). Pure and small: a client component may import this file (routes.ts, which knows the business types, may not).
 */
export const SITE_PAGES = ["pricing", "how-it-works", "security", "contact", "help"] as const;
export type SitePage = (typeof SITE_PAGES)[number];
export type SiteTarget = { kind: "home" } | { kind: "page"; page: SitePage } | { kind: "pack"; slug: string } | { kind: "for"; slug: string };

export const isSitePage = (v: string): v is SitePage => (SITE_PAGES as readonly string[]).includes(v);

const segment = (t: SiteTarget): string => (t.kind === "home" ? "" : t.kind === "page" ? t.page : t.slug);

/** "/", "/te", "/pricing", "/te/pricing", "/construction", "/hi/construction", "/for/real-estate". */
export function sitePath(lang: SiteLang, target: SiteTarget): string {
  if (target.kind === "for") return lang === "en" ? `/for/${target.slug}` : sitePath(lang, { kind: "home" });
  const seg = segment(target);
  const prefix = lang === "en" ? "" : `/${lang}`;
  return seg === "" ? prefix || "/" : `${prefix}/${seg}`;
}
