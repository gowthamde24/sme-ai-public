import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LandingView } from "@/components/v2/landing/LandingView";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";
import { landingMetadata } from "@/lib/seo/landing-metadata";

/**
 * The public landing page (design v2, Stage 2). Dynamically rendered under the nonce CSP (ADR 0060): it reads the two
 * functional preference cookies, so the first response is already in the visitor's language and theme.
 * The head (title, description, share picture, alternates, noindex until launch) is lib/seo/landing-metadata.ts (job BS).
 */
export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  return landingMetadata(readLang(jar.get(LANG_COOKIE)?.value), "/");
}

export default async function LandingPage() {
  const jar = await cookies();
  return <LandingView lang={readLang(jar.get(LANG_COOKIE)?.value)} theme={readTheme(jar.get(THEME_COOKIE)?.value)} />;
}
