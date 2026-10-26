import Link from "next/link";

import { EmailAddress } from "@/components/v2/site/EmailAddress";
import { emailWords } from "@/components/v2/site/email-words";
import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { container } from "@/components/v2/site/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { LANGS } from "@/i18n/lang";
import { ADDRESSES } from "@/lib/site/business";
import { isServed } from "@/lib/site/mode";
import { sitePath, SITE_PAGES, type SitePage, type SiteTarget } from "@/lib/site/paths";

const row = "inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-ink hover:underline";
const LABEL: Record<SitePage, "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" | "nav.help"> = { pricing: "nav.pricing", "how-it-works": "nav.how", security: "nav.security", contact: "nav.contact", help: "nav.help" };

/** The name of each language in that language, for the footer's language links (the same page in each). */
const LANG_NAME: Record<(typeof LANGS)[number], string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

export function SiteFooter({ t, lang, target = { kind: "home" } }: { t: SiteT; lang: Lang; target?: SiteTarget }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${container} grid gap-8 py-10 md:grid-cols-4`}>
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-muted">{t("foot.note")}</p>
          <p className="mt-4 text-sm font-semibold text-muted">{t("contact.addr.title")}</p>
          <EmailAddress address={ADDRESSES.hello} words={emailWords(t)} />
        </div>
        <nav aria-label={t("foot.businesses")}>
          <p className="text-sm font-semibold text-muted">{t("foot.businesses")}</p>
          <ul className="mt-1 flex flex-col">
            {SITE_PACKS.map((p) => (
              <li key={p.slug}>
                <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} className={row}>
                  {textIn(p.names, lang)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
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
            {LANGS.map((l) => (
              <li key={l}>
                <Link href={sitePath(l, target)} lang={l} hrefLang={l} aria-current={l === lang ? "true" : undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-ink hover:underline ${l === lang ? "font-bold" : ""}`}>
                  {LANG_NAME[l]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
