import type { Metadata } from "next";

import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { landingDict } from "@/i18n/landing";

import { LANDING_LANGS, OG_SIZE, SITE_LIVE, landingPath, ogImagePath } from "./site";

const LOCALE: Record<Lang, string> = { en: "en_IN", te: "te_IN", hi: "hi_IN", kn: "kn_IN" };
const HREFLANG: Record<Lang, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN" };

/**
 * The head of the public page in one language (job BS): a plain title and description in that language, the page's own address as canonical, the other languages as alternates, a share picture with
 * the owl (Open Graph and Twitter), and the robots rule: noindex until the launch switch is on (lib/seo/site.ts). `canonical` is the address this response is served at ("/" is cookie-driven, so it is
 * "/" whatever language the cookie says; "/te" is always Telugu).
 */
export function landingMetadata(lang: Lang, canonical: string = landingPath(lang)): Metadata {
  const dict = landingDict(lang);
  const title = fillPlain(dict["meta.title"]);
  const description = fillPlain(dict["meta.description"]);
  const image = { url: ogImagePath(lang), width: OG_SIZE.width, height: OG_SIZE.height, alt: fillPlain(dict["hero.h1"]) };
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { ...Object.fromEntries(LANDING_LANGS.map((l) => [HREFLANG[l], landingPath(l)])), "x-default": "/" },
    },
    robots: SITE_LIVE ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: BRAND_NAME, title, description, url: canonical, locale: LOCALE[lang], images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
