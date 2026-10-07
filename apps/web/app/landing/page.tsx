import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LandingView } from "@/components/v2/landing/LandingView";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import { landingDict } from "@/i18n/landing";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";

/**
 * The public landing page (design v2, Stage 2). Dynamically rendered under the nonce CSP (ADR 0060): it reads the two
 * functional preference cookies, so the first response is already in the visitor's language and theme.
 * Until launch: noindex, no og:image, no JSON-LD (owner decision, 2026-10-07).
 */
export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  const dict = landingDict(readLang(jar.get(LANG_COOKIE)?.value));
  const title = fillPlain(dict["meta.title"]);
  const description = fillPlain(dict["meta.description"]);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { type: "website", siteName: BRAND_NAME, title, description },
  };
}

export default async function LandingPage() {
  const jar = await cookies();
  return <LandingView lang={readLang(jar.get(LANG_COOKIE)?.value)} theme={readTheme(jar.get(THEME_COOKIE)?.value)} />;
}
