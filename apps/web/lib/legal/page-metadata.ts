import type { Metadata } from "next";

import { BRAND_NAME } from "@/design/brand";
import { OG_SIZE, SITE_LIVE, ogImagePath } from "@/lib/seo/site";

/**
 * The head of a legal page (job DB): its title with the product name, its own address as the canonical link (the address is relative: the root layout's metadataBase makes it https://stack19.com/...), the share picture
 * (Open Graph and Twitter), and the robots rule: open to search engines once the launch switch is on (lib/seo/site.ts), closed before. The pages themselves are public in both cases, so a reviewer at Meta or Google can read them.
 */
export function legalMetadata(path: "/privacy" | "/terms" | "/data-deletion", title: string, description: string): Metadata {
  const full = `${title} · ${BRAND_NAME}`;
  const image = { url: ogImagePath("en"), width: OG_SIZE.width, height: OG_SIZE.height, alt: BRAND_NAME };
  return {
    title: full,
    description,
    alternates: { canonical: path },
    robots: SITE_LIVE ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: BRAND_NAME, title: full, description, url: path, locale: "en_IN", images: [image] },
    twitter: { card: "summary_large_image", title: full, description, images: [image.url] },
  };
}
