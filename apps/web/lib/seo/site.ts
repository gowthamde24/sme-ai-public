import { CANONICAL_ORIGIN } from "@/lib/site/business";

/**
 * Where the public site lives and whether it is open to search engines (job BS).
 *  - PUBLIC_URL: the address the public site is known by, https://stack19.com (job DB, lib/site/business.ts): the canonical links, the sitemap, robots.txt and the Open Graph addresses. It does not depend on where a copy is served from.
 *  - NEXT_PUBLIC_SITE_URL: the address THIS deployment is served from (the sign-in redirect back to the app). Until the site is hosted it is the local address.
 *  - NEXT_PUBLIC_SITE_LIVE=1: the launch switch. Until then the pages say noindex, robots.txt turns every crawler away and the sitemap is empty (owner decision of 2026-10-07: not indexed before launch);
 *    the share pictures and titles are there already, so a link sent to a person still shows the owl.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const PUBLIC_URL = CANONICAL_ORIGIN;
export const SITE_LIVE = process.env.NEXT_PUBLIC_SITE_LIVE === "1";

export const LANDING_LANGS = ["en", "te", "hi", "kn"] as const;
export type LandingLang = (typeof LANDING_LANGS)[number];
/** The languages that have an address of their own ("/" is English). */
export const ROUTE_LANGS = ["te", "hi", "kn"] as const;
export type RouteLang = (typeof ROUTE_LANGS)[number];
export const isRouteLang = (v: string): v is RouteLang => (ROUTE_LANGS as readonly string[]).includes(v);

export const landingPath = (lang: LandingLang): string => (lang === "en" ? "/" : `/${lang}`);
export const ogImagePath = (lang: LandingLang): string => `/og/og-${lang}.png`;
/** The share picture of one business type's page in one language (job CM: `scripts/og-images.mjs` draws one for every page of the site that has a `slug`). */
export const ogImagePathForSlug = (slug: string, lang: LandingLang): string => `/og/og-${slug}-${lang}.png`;
export const OG_SIZE = { width: 1200, height: 630 } as const;
