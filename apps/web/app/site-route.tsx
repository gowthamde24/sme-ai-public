import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { SitePage, type SiteActions } from "@/components/v2/site/SitePage";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { requestIndexable } from "@/lib/seo/index-rule";
import { siteMetadata } from "@/lib/seo/site-metadata";
import { isServed } from "@/lib/site/mode";
import { resolveSite } from "@/lib/site/routes";
import { chatAvailable } from "@/lib/site/whatsapp";

import { prepareContactChat, prepareQuoteChat } from "./site-actions";
import { joinWaitlist } from "./waitlist-actions";

/**
 * The route files of the public site (job CM) all end here: the first one or two path segments are read as a language and a page ("/te", "/pricing", "/hi/construction"); anything that is neither is a 404, as before for
 * any other first segment. English is unprefixed, Telugu, Hindi and Kannada have a prefix, so the language is in the address (shareable, and a search engine can tell the languages apart). The words are machine-written drafts
 * for te, hi and kn and the page says so.
 */
export async function siteMetadataFor(segments: string[]): Promise<Metadata> {
  const hit = resolveSite(segments);
  return hit && isServed(hit.target) ? siteMetadata(hit.lang, hit.target, undefined, await requestIndexable()) : {};
}

export async function SiteRoute({ segments }: { segments: string[] }) {
  const hit = resolveSite(segments);
  if (!hit || !isServed(hit.target)) notFound();
  const jar = await cookies();
  const actions: SiteActions = { contactChat: prepareContactChat, quoteChat: prepareQuoteChat, chatAvailable: chatAvailable(), waitlist: joinWaitlist };
  return <SitePage lang={hit.lang} theme={readTheme(jar.get(THEME_COOKIE)?.value)} target={hit.target} actions={actions} />;
}
