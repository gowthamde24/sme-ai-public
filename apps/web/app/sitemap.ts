import type { MetadataRoute } from "next";

import { requestIndexable } from "@/lib/seo/index-rule";
import { LANDING_LANGS, PUBLIC_URL } from "@/lib/seo/site";
import { isServed } from "@/lib/site/mode";
import { sitePath } from "@/lib/site/paths";
import { allTargets } from "@/lib/site/routes";

export const dynamic = "force-dynamic";

/** sitemap.xml (job BS, extended by jobs CM and DQ): every page the site serves, in every language, with its language alternates; empty unless the response may be indexed (lib/seo/index-rule.ts). Website mode lists only the pages it serves. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!(await requestIndexable())) return [];
  const pages = allTargets().filter((target) => isServed(target)).flatMap((target) => {
    const languages = Object.fromEntries(LANDING_LANGS.map((l) => [l === "en" ? "en-IN" : `${l}-IN`, PUBLIC_URL + sitePath(l, target)]));
    return LANDING_LANGS.map((l) => ({ url: PUBLIC_URL + sitePath(l, target), changeFrequency: "monthly" as const, priority: target.kind === "home" ? (l === "en" ? 1 : 0.8) : l === "en" ? 0.7 : 0.5, alternates: { languages } }));
  });
  const legal = ["/privacy", "/terms", "/data-deletion"].map((path) => ({ url: `${PUBLIC_URL}${path}`, changeFrequency: "yearly" as const, priority: 0.3 }));
  return [...pages, ...legal];
}
