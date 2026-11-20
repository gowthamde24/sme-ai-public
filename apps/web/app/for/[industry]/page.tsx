import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { IndustryPage } from "@/components/v2/site/IndustryPage";
import { SiteShell } from "@/components/v2/site/SiteShell";
import { BRAND_NAME } from "@/design/brand";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { siteT } from "@/i18n/site";
import { industryPages } from "@/lib/screens/flag";
import { requestIndexable } from "@/lib/seo/index-rule";
import { OG_SIZE, ogImagePath } from "@/lib/seo/site";
import { industryBySlug } from "@/lib/site/industries";

import { joinWaitlist } from "../../waitlist-actions";

type Props = { params: Promise<{ industry: string }> };

/** `/for/real-estate`, `/for/education`, ...: industry SEO pages behind `INDUSTRY_PAGES=1` (English only first). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!industryPages()) return {};
  const { industry } = await params;
  const page = industryBySlug(industry);
  if (!page) return {};
  const canonical = `/for/${page.slug}`;
  const index = await requestIndexable();
  const image = ogImagePath("en");
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title: page.metaTitle,
      description: page.metaDescription,
      url: canonical,
      locale: "en_IN",
      images: [{ url: image, width: OG_SIZE.width, height: OG_SIZE.height, alt: page.headline }],
    },
    twitter: { card: "summary_large_image", title: page.metaTitle, description: page.metaDescription, images: [image] },
  };
}

export default async function IndustrySeoRoute({ params }: Props) {
  if (!industryPages()) notFound();
  const { industry } = await params;
  const page = industryBySlug(industry);
  if (!page) notFound();
  const jar = await cookies();
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const t = siteT("en");
  return (
    <SiteShell lang="en" theme={theme} t={t} target={{ kind: "for", slug: page.slug }}>
      <IndustryPage industry={page} t={t} waitlist={joinWaitlist} />
    </SiteShell>
  );
}
