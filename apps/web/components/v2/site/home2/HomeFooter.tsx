import Link from "next/link";

import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { SupportedBy } from "@/components/v2/site/SupportedBy";
import type { SiteT } from "@/i18n/site";
import { LANGS, type Lang } from "@/i18n/lang";
import { isServed } from "@/lib/site/mode";
import { sitePath, SITE_PAGES, type SitePage } from "@/lib/site/paths";

import { WithWhatsapp } from "./WithWhatsapp";

const link = "inline-flex min-h-11 items-center text-[15px] font-semibold text-muted hover:text-ink";
const head = "mb-1.5 text-[13px] font-extrabold text-muted";
const LABEL: Record<SitePage, "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" | "nav.help"> = { pricing: "nav.pricing", "how-it-works": "nav.how", security: "nav.security", contact: "nav.contact", help: "nav.help" };
const LANG_NAME: Record<Lang, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

/**
 * The home page's footer (landing v2 part B.13): the line, the product's sections (no business type is linked from the home page), the company's pages (only the ones that are served), "Talk to us" with the WhatsApp placeholder, then the dot-built wordmark
 * on its reflecting floor, then the copyright, the languages of this page and "Back to the top". Server markup; the wordmark is a lazy island.
 */
export function HomeFooter({ t, lang, early }: { t: SiteT; lang: Lang; early: { href: string; label: string } }) {
  return (
    <footer id="end" className="relative overflow-hidden px-[var(--h3-gutter,clamp(16px,3vw,32px))] pb-4 pt-[clamp(32px,6vw,80px)]" data-part="home-footer">
      <div className="h3-foot-grid relative mx-auto max-w-[1240px] border-b border-line pb-9">
        <div className="flex flex-col gap-3.5">
          <p className="m-0 max-w-[380px] font-display text-[clamp(22px,calc(1vw+16px),28px)] font-extrabold leading-[1.15] tracking-[-0.02em]">
            {t("h3.hero.t")}
          </p>
          <p className="m-0 max-w-[380px] text-sm leading-relaxed text-muted">{t("h2.foot.line")}</p>
        </div>
        <nav aria-label={t("h2.foot.product")} className="flex flex-col">
          <span className={head}>{t("h2.foot.product")}</span>
          <a className={link} href="#how">{t("nav.how")}</a>
          <a className={link} href="#finder">{t("h2.nav.finder")}</a>
          <a className={link} href="#built">{t("h3.built.title")}</a>
          <a className={link} href="#plans">{t("h2.nav.plans")}</a>
        </nav>
        <div className="flex flex-col">
          <span className={head}>{t("h2.foot.company")}</span>
          <nav aria-label={t("foot.pages")} className="flex flex-col">
            {SITE_PAGES.filter((page) => isServed({ kind: "page", page })).map((page) => (
              <Link key={page} className={link} href={sitePath(lang, { kind: "page", page })}>
                {t(LABEL[page])}
              </Link>
            ))}
          </nav>
          <LegalLinks lang={lang} direction="column" contact={false} linkClass={link} />
        </div>
        <div className="flex flex-col gap-2.5">
          <span className={head}>{t("h2.foot.talk")}</span>
          <p className="m-0 text-[15px] font-semibold">
            <WithWhatsapp text={t("h2.foot.whatsapp")} />
          </p>
          <Link href={early.href} className="inline-flex min-h-11 self-start items-center rounded-full bg-ink px-5 text-sm font-extrabold text-bg">
            {early.label}
          </Link>
        </div>
      </div>
      <div className="relative mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-[18px] text-[13px] text-muted">
        <span>{t("h2.foot.copy")}</span>
        <nav aria-label={t("nav.languages")}>
          <ul className="m-0 flex list-none flex-wrap p-0" data-part="foot-langs">
            {LANGS.map((l) => (
              <li key={l}>
                <Link href={sitePath(l, { kind: "home" })} lang={l} hrefLang={l} aria-current={l === lang ? "true" : undefined} className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-medium text-ink hover:underline ${l === lang ? "font-bold" : ""}`}>
                  {LANG_NAME[l]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <a href="#top" className="inline-flex min-h-11 items-center gap-2 font-bold text-muted hover:text-ink">
          {t("h2.foot.top")}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </a>
        <SupportedBy t={t} />
      </div>
    </footer>
  );
}
