import Link from "next/link";

import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { SupportedBy } from "@/components/v2/site/SupportedBy";
import { BRAND_NAME } from "@/design/brand";
import type { SiteT } from "@/i18n/site";
import { type SiteLang } from "@/i18n/lang";
import { SITE_LANGS, SITE_LANGUAGE_NAMES } from "@/i18n/site-lang";
import { isServed } from "@/lib/site/mode";
import { sitePath, SITE_PAGES, type SitePage } from "@/lib/site/paths";

import { BrandMark } from "./BrandMark";
import { WithWhatsapp } from "./WithWhatsapp";

const link = "inline-flex min-h-11 min-w-11 items-center text-[15px] font-semibold text-muted hover:text-ink";
const head = "mb-1.5 text-sm font-extrabold text-muted";
const LABEL: Record<SitePage, "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" | "nav.help" | "nav.status" | "nav.aup" | "nav.refunds" | "nav.talk"> = { pricing: "nav.pricing", "how-it-works": "nav.how", security: "nav.security", contact: "nav.contact", help: "nav.help", status: "nav.status", "acceptable-use": "nav.aup", refunds: "nav.refunds", "talk-to-us": "nav.talk" };

/**
 * The home page's footer (landing v2 part B.13): the line, the product's sections (no business type is linked from the home page), the company's pages (only the ones that are served), "Talk to us" with the WhatsApp placeholder, then the dot-built wordmark
 * on its reflecting floor, then the copyright, the languages of this page and "Back to the top". Server markup; the wordmark is a lazy island.
 */
export function HomeFooter({ t, lang }: { t: SiteT; lang: SiteLang; early?: { href: string; label: string } }) {
  return (
    <footer id="end" className="relative overflow-hidden px-[var(--h3-gutter,clamp(16px,3vw,32px))] pb-0 pt-[clamp(24px,6vw,80px)]" data-part="home-footer">
      <div className="h3-foot-grid relative mx-auto max-w-[1240px] border-b border-line pb-4">
        <div className="h3-foot-wide flex flex-col">
          <p className="m-0 max-w-[420px] text-[15px] leading-snug text-muted">{t("h2.foot.line")}</p>
        </div>
        <nav aria-label={t("h2.foot.product")} className="h3-foot-wide h3-foot-links">
          <span className={head}>{t("h2.foot.product")}</span>
          <a className={link} href="#how-it-works">{t("nav.how")}</a>
          <a className={link} href="#lead-finder">{t("h2.nav.finder")}</a>
          <a className={link} href="#pricing">{t("nav.pricing")}</a>
          <a className={link} href="#faq">{t("h4.nav.faq")}</a>
        </nav>
        <div className="h3-foot-wide flex flex-col">
          <span className={head}>{t("h2.foot.company")}</span>
          <div className="flex flex-wrap items-center gap-x-4 min-[560px]:flex-col min-[560px]:items-start min-[560px]:gap-x-0">
            <nav aria-label={t("foot.pages")} className="flex flex-wrap gap-x-4 min-[560px]:flex-col min-[560px]:gap-x-0">
              {SITE_PAGES.filter((page) => isServed({ kind: "page", page }) && page !== "pricing" && page !== "how-it-works").map((page) => ( // (Pricing and How it works are in the Product column on this page)
                <Link key={page} className={link} href={sitePath(lang, { kind: "page", page })}>
                  {t(LABEL[page])}
                </Link>
              ))}
            </nav>
            <LegalLinks lang={lang} direction="row" contact={false} linkClass={link} />
          </div>
        </div>
        <div className="h3-foot-wide flex flex-wrap items-center gap-x-3 min-[560px]:flex-col min-[560px]:items-start min-[560px]:gap-x-0">
          <span className="text-sm font-extrabold text-muted">{t("h2.foot.talk")}</span>
          <p className="m-0 text-[15px] font-semibold">
            <WithWhatsapp text={t("h2.foot.whatsapp")} />
          </p>
        </div>
      </div>
      <div className="relative mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-[18px] text-sm text-muted">
        <span>{t("h2.foot.copy")}</span>
        <nav aria-label={t("nav.languages")}>
          <ul className="m-0 flex list-none flex-wrap p-0" data-part="foot-langs">
            {SITE_LANGS.map((l) => (
              <li key={l}>
                <Link href={sitePath(l, { kind: "home" })} lang={l} hrefLang={l} aria-current={l === lang ? "true" : undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-ink hover:underline ${l === lang ? "font-bold" : ""}`}>
                  {SITE_LANGUAGE_NAMES[l].native}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SupportedBy t={t} />
      </div>
      {/* the dot-matrix wordmark: the logo and the name built from the page's own dots, the letters standing on the page's bottom edge (a still picture in CSS; one image to a screen reader) */}
      <BrandMark label={BRAND_NAME} />
    </footer>
  );
}
