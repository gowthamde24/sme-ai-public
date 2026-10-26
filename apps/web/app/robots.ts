import type { MetadataRoute } from "next";

import { requestIndexable } from "@/lib/seo/index-rule";
import { PUBLIC_URL } from "@/lib/seo/site";

// the rule depends on the address of the request and on SITE_MODE, read when the request comes: never prerendered
export const dynamic = "force-dynamic";

/**
 * robots.txt (job BS, job DQ): closed to every crawler unless the response may be indexed (lib/seo/index-rule.ts: the launch switch NEXT_PUBLIC_SITE_LIVE=1, or website mode served from stack19.com); then the public pages are open and
 * the signed-in app, the API and the sign-in pages are not. Staging, previews and every other address are always closed.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await requestIndexable())) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: ["/", "/te", "/hi", "/kn", "/privacy", "/terms", "/data-deletion"], disallow: ["/app", "/auth", "/api", "/login", "/signup", "/setup", "/landing", "/opening-soon"] }],
    sitemap: `${PUBLIC_URL}/sitemap.xml`,
    host: PUBLIC_URL,
  };
}
