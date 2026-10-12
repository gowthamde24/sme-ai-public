import type { MetadataRoute } from "next";

import { SITE_LIVE, SITE_URL } from "@/lib/seo/site";

/** robots.txt (job BS): closed to every crawler until the launch switch (NEXT_PUBLIC_SITE_LIVE=1); then the public pages are open and the signed-in app, the API and the sign-in pages are not. */
export default function robots(): MetadataRoute.Robots {
  if (!SITE_LIVE) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: ["/", "/te", "/hi", "/kn", "/privacy", "/terms"], disallow: ["/app", "/auth", "/api", "/login", "/signup", "/setup", "/landing"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
