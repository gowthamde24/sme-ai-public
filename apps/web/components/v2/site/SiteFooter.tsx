import Link from "next/link";

import { EmailAddress } from "@/components/v2/site/EmailAddress";
import { emailWords } from "@/components/v2/site/email-words";
import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { container } from "@/components/v2/site/ui";
import { HomeFooter } from "@/components/v2/site/home2/HomeFooter";
import { SupportedBy } from "@/components/v2/site/SupportedBy";
import { Wordmark } from "@/components/v2/Wordmark";
import type { SiteT } from "@/i18n/site";
import type { SiteLang } from "@/i18n/lang";
import { SITE_LANGS, SITE_LANGUAGE_NAMES } from "@/i18n/site-lang";
import { ADDRESSES } from "@/lib/site/business";
import { isServed } from "@/lib/site/mode";
import { sitePath, SITE_PAGES, type SitePage, type SiteTarget } from "@/lib/site/paths";

const row = "inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-ink hover:underline";
const LABEL: Record<SitePage, "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" | "nav.help" | "nav.status" | "nav.aup" | "nav.refunds" | "nav.talk"> = { pricing: "nav.pricing", "how-it-works": "nav.how", security: "nav.security", contact: "nav.contact", help: "nav.help", status: "nav.status", "acceptable-use": "nav.aup", refunds: "nav.refunds", "talk-to-us": "nav.talk" };

/** The name of each language in that language, for the footer's language links (the same page in each). */

export function SiteFooter({ t, lang, target = { kind: "home" }, early }: { t: SiteT; lang: SiteLang; target?: SiteTarget; /** The home page's "Get early access" (landing v2): its footer is the new one. */ early?: { href: string; label: string } }) {
  if (target.kind === "home" && early) return <HomeFooter t={t} lang={lang} early={early} />;
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${container} grid gap-8 py-10 md:grid-cols-3`}>
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-muted">{t("foot.note")}</p>
          <p className="mt-4 text-sm font-semibold text-muted">{t("contact.addr.title")}</p>
          <EmailAddress address={ADDRESSES.hello} words={emailWords(t)} />
        </div>
        <nav aria-label={t("foot.pages")}>
          <p className="text-sm font-semibold text-muted">{t("foot.pages")}</p>
          <ul className="mt-1 flex flex-col">
            {SITE_PAGES.filter((page) => isServed({ kind: "page", page })).map((page) => (
              <li key={page}>
                <Link href={sitePath(lang, { kind: "page", page })} className={row}>
                  {t(LABEL[page])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <LegalLinks lang={lang} direction="column" contact={false} />
        </div>
      </div>
      <div className={`${container} flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line py-4 text-sm text-muted`}>
        <p>{t("foot.copy")}</p>
        <nav aria-label={t("nav.languages")} className="ml-auto">
          <ul className="flex flex-wrap" data-part="foot-langs">
            {SITE_LANGS.map((l) => (
              <li key={l}>
                <Link href={sitePath(l, target)} lang={l} hrefLang={l} aria-current={l === lang ? "true" : undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-ink hover:underline ${l === lang ? "font-bold" : ""}`}>
                  {SITE_LANGUAGE_NAMES[l].native}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SupportedBy t={t} />
      </div>
    </footer>
  );
}
