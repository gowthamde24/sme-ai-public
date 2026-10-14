import Link from "next/link";

import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { container } from "@/components/v2/site/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { sitePath, SITE_PAGES, type SitePage } from "@/lib/site/paths";

const row = "inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-ink hover:underline";
const LABEL: Record<SitePage, "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" | "nav.help"> = { pricing: "nav.pricing", "how-it-works": "nav.how", security: "nav.security", contact: "nav.contact", help: "nav.help" };

export function SiteFooter({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${container} grid gap-8 py-10 md:grid-cols-4`}>
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-muted">{t("foot.note")}</p>
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
            {SITE_PAGES.map((page) => (
              <li key={page}>
                <Link href={sitePath(lang, { kind: "page", page })} className={row}>
                  {t(LABEL[page])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <LegalLinks lang={lang} direction="column" />
        </div>
      </div>
      <p className={`${container} border-t border-line py-5 text-sm text-muted`}>{t("foot.copy")}</p>
    </footer>
  );
}
