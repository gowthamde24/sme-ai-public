import type { Lang } from "@/i18n/lang";

/**
 * The addresses of the public site (job CM). English has no prefix ("/pricing"), Telugu, Hindi and Kannada have one ("/te/pricing"), so a link can be shared and a search engine can tell the languages apart. A page is the
 * home page, one of the fixed pages below, or the page of a business type (its `slug` from landing.json). Pure and small: a client component may import this file (routes.ts, which knows the business types, may not).
 */
export const SITE_PAGES = ["pricing", "how-it-works", "security", "contact", "help"] as const;
export type SitePage = (typeof SITE_PAGES)[number];
export type SiteTarget = { kind: "home" } | { kind: "page"; page: SitePage } | { kind: "pack"; slug: string };

export const isSitePage = (v: string): v is SitePage => (SITE_PAGES as readonly string[]).includes(v);

const segment = (t: SiteTarget): string => (t.kind === "home" ? "" : t.kind === "page" ? t.page : t.slug);

/** "/", "/te", "/pricing", "/te/pricing", "/construction", "/hi/construction". */
export function sitePath(lang: Lang, target: SiteTarget): string {
  const seg = segment(target);
  const prefix = lang === "en" ? "" : `/${lang}`;
  return seg === "" ? prefix || "/" : `${prefix}/${seg}`;
}
