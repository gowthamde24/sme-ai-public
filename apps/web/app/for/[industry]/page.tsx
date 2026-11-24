import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { IndustryPage } from "@/components/v2/site/v9/IndustryPage";
import { V2Root } from "@/components/v2/V2Root";
import { BRAND_NAME } from "@/design/brand";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { siteT } from "@/i18n/site";
import { industryPages } from "@/lib/screens/flag";
import { requestIndexable } from "@/lib/seo/index-rule";
import { OG_SIZE, ogImagePath } from "@/lib/seo/site";
import { INDUSTRY_PAGES, industryBySlug } from "@/lib/site/industries";

type Props = { params: Promise<{ industry: string }> };

/** `/for/clinics`, `/for/wholesale`, ...: the industry pages behind INDUSTRY_PAGES=1, English only. Off: a 404 (and no sitemap entry). */
export const dynamicParams = true;
export function generateStaticParams() {
  return INDUSTRY_PAGES.map((p) => ({ industry: p.slug }));
}

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
    openGraph: { type: "website", siteName: BRAND_NAME, title: page.metaTitle, description: page.metaDescription, url: canonical, locale: "en_IN", images: [{ url: image, width: OG_SIZE.width, height: OG_SIZE.height, alt: page.headline }] },
    twitter: { card: "summary_large_image", title: page.metaTitle, description: page.metaDescription, images: [image] },
  };
}

export default async function IndustryRoute({ params }: Props) {
  if (!industryPages()) notFound();
  const { industry } = await params;
  const page = industryBySlug(industry);
  if (!page) notFound();
  const jar = await cookies();
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const t = siteT("en");
  return (
    <V2Root theme={theme} lang="en" site className="min-h-screen">
      <div id="top" data-screen="landing" data-page="industry">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("skip")}
        </a>
        <IndustryPage industry={page} t={t} />
      </div>
    </V2Root>
  );
}
