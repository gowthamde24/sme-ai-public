import type { MetadataRoute } from "next";

import { LANDING_LANGS, SITE_LIVE, SITE_URL, landingPath } from "@/lib/seo/site";

/** sitemap.xml (job BS): the public pages with their language alternates; empty until the launch switch is on (see lib/seo/site.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_LIVE) return [];
  const languages = Object.fromEntries(LANDING_LANGS.map((l) => [l === "en" ? "en-IN" : `${l}-IN`, SITE_URL + landingPath(l)]));
  return [
    ...LANDING_LANGS.map((l) => ({ url: SITE_URL + landingPath(l), changeFrequency: "monthly" as const, priority: l === "en" ? 1 : 0.8, alternates: { languages } })),
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly" as const, priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly" as const, priority: 0.3 },
  ];
}
