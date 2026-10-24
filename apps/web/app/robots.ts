import type { MetadataRoute } from "next";

import { PUBLIC_URL, SITE_LIVE } from "@/lib/seo/site";

/** robots.txt (job BS): closed to every crawler until the launch switch (NEXT_PUBLIC_SITE_LIVE=1); then the public pages are open and the signed-in app, the API and the sign-in pages are not. */
export default function robots(): MetadataRoute.Robots {
  if (!SITE_LIVE) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: ["/", "/te", "/hi", "/kn", "/privacy", "/terms", "/data-deletion"], disallow: ["/app", "/auth", "/api", "/login", "/signup", "/setup", "/landing"] }],
    sitemap: `${PUBLIC_URL}/sitemap.xml`,
    host: PUBLIC_URL,
  };
}
