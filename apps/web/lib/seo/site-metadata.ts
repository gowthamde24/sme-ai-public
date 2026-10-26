import type { Metadata } from "next";

import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { siteDict } from "@/i18n/site";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { sitePath, type SiteTarget } from "@/lib/site/paths";

import { LANDING_LANGS, OG_SIZE, SITE_LIVE, ogImagePath, ogImagePathForSlug } from "./site";

const LOCALE: Record<Lang, string> = { en: "en_IN", te: "te_IN", hi: "hi_IN", kn: "kn_IN" };
const HREFLANG: Record<Lang, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN" };

/** The title and the description of a page in one language. */
export function pageText(lang: Lang, target: SiteTarget): { title: string; description: string; image: string; imageAlt: string } {
  const d = siteDict(lang);
  const home = { title: d["meta.title"], description: d["meta.description"], image: ogImagePath(lang), imageAlt: d["hero.h1"] };
  if (target.kind === "home") return { ...home, title: fillPlain(home.title), description: fillPlain(home.description), imageAlt: fillPlain(home.imageAlt) };
  if (target.kind === "pack") {
    const pack = SITE_PACKS.find((p) => p.slug === target.slug);
    if (pack) return { title: fillPlain(textIn(pack.meta.title, lang)), description: fillPlain(textIn(pack.meta.description, lang)), image: ogImagePathForSlug(pack.slug, lang), imageAlt: fillPlain(textIn(pack.hero.h1, lang)) };
  }
  const key = target.kind === "page" ? ({ pricing: "pricing", "how-it-works": "how", security: "security", contact: "contact", help: "help" } as const)[target.page] : "pricing";
  return { title: fillPlain(d[`meta.${key}.title`]), description: fillPlain(d[`meta.${key}.description`]), image: home.image, imageAlt: fillPlain(home.imageAlt) };
}

/**
 * The head of one public page in one language (job CM, extending job BS): a plain title and description in that language, the page's own address as canonical, the same page in the other languages as alternates, a share
 * picture with the owl (Open Graph and Twitter; a business type's page has its own), and the robots rule: noindex unless `index` (lib/seo/index-rule.ts: the launch switch, or website mode served from stack19.com). `canonical` is the address this response is served at ("/"
 * is cookie-driven, so it is "/" whatever language the cookie says; "/te" is always Telugu).
 */
export function siteMetadata(lang: Lang, target: SiteTarget, canonical: string = sitePath(lang, target), index: boolean = SITE_LIVE): Metadata {
  const { title, description, image, imageAlt } = pageText(lang, target);
  const img = { url: image, width: OG_SIZE.width, height: OG_SIZE.height, alt: imageAlt };
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { ...Object.fromEntries(LANDING_LANGS.map((l) => [HREFLANG[l], sitePath(l, target)])), "x-default": sitePath("en", target) },
    },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: BRAND_NAME, title, description, url: canonical, locale: LOCALE[lang], images: [img] },
    twitter: { card: "summary_large_image", title, description, images: [img.url] },
  };
}
