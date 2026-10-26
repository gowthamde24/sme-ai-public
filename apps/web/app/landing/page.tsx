import type { Metadata } from "next";
import { cookies } from "next/headers";

import { SitePage } from "@/components/v2/site/SitePage";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";
import { requestIndexable } from "@/lib/seo/index-rule";
import { siteMetadata } from "@/lib/seo/site-metadata";
import { chatAvailable } from "@/lib/site/whatsapp";

import { prepareContactChat, prepareQuoteChat } from "../site-actions";
import { joinWaitlist } from "../waitlist-actions";

/**
 * The public home page at "/" (design v2, Stage 2; rebuilt by job CM as the first page of a small site). Dynamically rendered under the nonce CSP (ADR 0060): it reads the two functional preference cookies, so the first
 * response is already in the visitor's language and theme. "/" and "/landing" are the same page; "/te", "/hi", "/kn" are the home page in one language (app/[first]). The head is lib/seo/site-metadata.ts.
 */
export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  return siteMetadata(readLang(jar.get(LANG_COOKIE)?.value), { kind: "home" }, "/", await requestIndexable());
}

export default async function LandingPage() {
  const jar = await cookies();
  return <SitePage lang={readLang(jar.get(LANG_COOKIE)?.value)} theme={readTheme(jar.get(THEME_COOKIE)?.value)} target={{ kind: "home" }} actions={{ contactChat: prepareContactChat, quoteChat: prepareQuoteChat, chatAvailable: chatAvailable(), waitlist: joinWaitlist }} />;
}
