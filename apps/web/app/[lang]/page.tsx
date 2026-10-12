import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LandingView } from "@/components/v2/landing/LandingView";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { landingMetadata } from "@/lib/seo/landing-metadata";
import { isRouteLang } from "@/lib/seo/site";

/**
 * The public page in Telugu, Hindi or Kannada at an address of its own ("/te", "/hi", "/kn"; job BS): the language is in the address, not in a cookie, so the link can be shared, found and told apart by a
 * search engine. English is "/". The words are machine-written drafts and the page says so (draft.banner). Any other first path segment is a 404, as before.
 */
type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isRouteLang(lang) ? landingMetadata(lang) : {};
}

export default async function LanguageLandingPage({ params }: Props) {
  const { lang } = await params;
  if (!isRouteLang(lang)) notFound();
  const jar = await cookies();
  return <LandingView lang={lang} theme={readTheme(jar.get(THEME_COOKIE)?.value)} />;
}
