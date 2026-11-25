import { ContactPage } from "@/components/v2/site/ContactPage";
import { HomePage } from "@/components/v2/site/HomePage";
import { HowPage } from "@/components/v2/site/HowPage";
import { PackPage } from "@/components/v2/site/PackPage";
import { SecurityPage } from "@/components/v2/site/SecurityPage";
import { HelpArticlePage, HelpCenter, PricingPublic, RulesPage, StatusPublic, TalkPage } from "@/components/v2/site/public/PublicPages";
import { SiteShell } from "@/components/v2/site/SiteShell";
import type { WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { pubT } from "@/i18n/public";
import { siteT } from "@/i18n/site";
import type { Health } from "@/lib/public/health";
import type { TalkAction } from "@/lib/public/demo";
import type { SiteLang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";
import type { LeadResult } from "@/lib/site/lead";
import { packBySlug } from "@/lib/site/packs";
import type { SiteTarget } from "@/lib/site/paths";

export type SiteActions = { contactChat: (input: unknown) => Promise<LeadResult>; quoteChat: (input: unknown) => Promise<LeadResult>; chatAvailable: boolean; waitlist?: WaitlistAction; /** The launch pages: the status page's reading of the API's /health, and the Talk to us action. */ health?: Health; talk?: TalkAction };

/**
 * One page of the public site in one language, as a pure component (job CM): the route files read the cookie for the theme and our WhatsApp number's availability and pass them in, so a test renders every page in every
 * language without Next's request APIs. A target that is not a page of the site (an unknown business type slug) renders nothing: the route has already answered 404.
 */
export function SitePage({ lang, theme, target, actions }: { lang: SiteLang; theme?: Theme; target: SiteTarget; actions: SiteActions }) {
  const t = siteT(lang);
  const p = pubT(lang);
  let body = null;
  if (target.kind === "home") body = <HomePage t={t} lang={lang} waitlist={actions.waitlist} />;
  else if (target.kind === "pack") {
    const pack = packBySlug(target.slug);
    body = pack ? <PackPage pack={pack} t={t} lang={lang} actions={{ quoteChat: actions.quoteChat, chatAvailable: actions.chatAvailable, waitlist: actions.waitlist }} /> : null;
  } else if (target.kind === "article") body = <HelpArticlePage t={t} p={p} lang={lang} slug={target.slug} />;
  else if (target.page === "pricing") body = <PricingPublic t={t} p={p} lang={lang} />;
  else if (target.page === "how-it-works") body = <HowPage t={t} lang={lang} />;
  else if (target.page === "security") body = <SecurityPage t={t} lang={lang} />;
  else if (target.page === "contact") body = <ContactPage t={t} lang={lang} chatAvailable={actions.chatAvailable} action={actions.contactChat} waitlist={actions.waitlist} />;
  else if (target.page === "status") body = <StatusPublic p={p} health={actions.health} />;
  else if (target.page === "acceptable-use") body = <RulesPage t={t} p={p} kind="aup" />;
  else if (target.page === "refunds") body = <RulesPage t={t} p={p} kind="refund" />;
  else if (target.page === "talk-to-us") body = <TalkPage p={p} lang={lang} action={actions.talk} />;
  else body = <HelpCenter t={t} p={p} lang={lang} />;
  return (
    <SiteShell lang={lang} theme={theme} t={t} target={target}>
      {body}
    </SiteShell>
  );
}
