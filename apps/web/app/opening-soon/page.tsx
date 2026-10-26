import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { OpeningSoon } from "@/components/v2/site/OpeningSoon";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";
import { siteT } from "@/i18n/site";
import { websiteOnly } from "@/lib/site/mode";

import { joinWaitlist } from "../waitlist-actions";

/**
 * /opening-soon (job DQ): what the app and the sign-in pages show in website mode (proxy.ts rewrites /app, /login, /signup, /setup and /auth to it). Outside website mode the page does not exist. Never indexed: it stands in for
 * addresses that must not be.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = readLang((await cookies()).get(LANG_COOKIE)?.value);
  return { title: fillPlain(siteT(lang)("meta.soon.title")) || BRAND_NAME, robots: { index: false, follow: false } };
}

export default async function OpeningSoonPage() {
  if (!websiteOnly()) notFound();
  const jar = await cookies();
  return <OpeningSoon lang={readLang(jar.get(LANG_COOKIE)?.value)} theme={readTheme(jar.get(THEME_COOKIE)?.value)} waitlist={joinWaitlist} />;
}
