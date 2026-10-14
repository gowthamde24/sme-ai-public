import type { MetadataRoute } from "next";

import { LANDING_LANGS, SITE_LIVE, SITE_URL } from "@/lib/seo/site";
import { sitePath } from "@/lib/site/paths";
import { allTargets } from "@/lib/site/routes";

/** sitemap.xml (job BS, extended by job CM): every page of the public site in every language with its language alternates; empty until the launch switch is on (see lib/seo/site.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_LIVE) return [];
  const pages = allTargets().flatMap((target) => {
    const languages = Object.fromEntries(LANDING_LANGS.map((l) => [l === "en" ? "en-IN" : `${l}-IN`, SITE_URL + sitePath(l, target)]));
    return LANDING_LANGS.map((l) => ({ url: SITE_URL + sitePath(l, target), changeFrequency: "monthly" as const, priority: target.kind === "home" ? (l === "en" ? 1 : 0.8) : l === "en" ? 0.7 : 0.5, alternates: { languages } }));
  });
  return [...pages, { url: `${SITE_URL}/privacy`, changeFrequency: "yearly" as const, priority: 0.3 }, { url: `${SITE_URL}/terms`, changeFrequency: "yearly" as const, priority: 0.3 }];
}
