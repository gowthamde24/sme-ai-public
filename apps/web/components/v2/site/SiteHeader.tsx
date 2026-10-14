import { Menu } from "lucide-react";
import Link from "next/link";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { btnPrimary, container } from "@/components/v2/site/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import type { SiteT } from "@/i18n/site";
import { LANGS, type Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { sitePath, type SitePage, type SiteTarget } from "@/lib/site/paths";

const FIXED: { page: SitePage; key: "nav.pricing" | "nav.how" | "nav.security" | "nav.contact" }[] = [
  { page: "pricing", key: "nav.pricing" },
  { page: "how-it-works", key: "nav.how" },
  { page: "security", key: "nav.security" },
  { page: "contact", key: "nav.contact" },
];
const link = "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-2";

/**
 * The header of every public page (job CM): the wordmark, the pages (the business types with a public page, Pricing, How it works, Security, Contact), Sign in, the language (this page in the other languages) and the theme,
 * and the one button of the site, "Start free". On a phone the pages are a native disclosure (`<details>`, no script); the language, theme and the button stay in the bar.
 */
export function SiteHeader({ t, lang, theme, target }: { t: SiteT; lang: Lang; theme?: Theme; target: SiteTarget }) {
  const hrefs = Object.fromEntries(LANGS.map((l) => [l, sitePath(l, target)])) as Record<Lang, string>;
  const nav = [
    ...SITE_PACKS.map((p) => ({ href: sitePath(lang, { kind: "pack", slug: p.slug }), label: textIn(p.names, lang), here: target.kind === "pack" && target.slug === p.slug })),
    ...FIXED.map((f) => ({ href: sitePath(lang, { kind: "page", page: f.page }), label: t(f.key), here: target.kind === "page" && target.page === f.page })),
  ];
  return (
    <header className="[position:sticky] top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className={`${container} flex min-h-16 items-center gap-2 py-2 sm:gap-3`}>
        <Link href={sitePath(lang, { kind: "home" })} className="shrink-0 whitespace-nowrap rounded-md" aria-label={BRAND_NAME}>
          <Wordmark />
        </Link>
        <nav aria-label={t("nav.sections")} className="ml-4 hidden items-center gap-0.5 2xl:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.here ? "page" : undefined} className={`${link} ${n.here ? "bg-surface-2 font-semibold" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href="/login" className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-brand-text hover:underline md:inline-flex">
            {t("nav.signin")}
          </Link>
          <LangSelect lang={lang} label={t("lang.label")} hrefs={hrefs} />
          <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
          <span className="hidden sm:block">
            <Link href="/signup" className={`${btnPrimary} !min-h-11 whitespace-nowrap px-4 text-sm`}>
              {t("nav.start")}
            </Link>
          </span>
          <details className="group relative 2xl:hidden">
            <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <Menu className="size-5" aria-hidden="true" />
              <span className="sr-only">{t("nav.menu")}</span>
            </summary>
            <nav aria-label={t("nav.sections")} className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]">
              <ul className="flex flex-col">
                {nav.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={n.here ? "page" : undefined} className={`${link} w-full ${n.here ? "bg-surface-2 font-semibold" : ""}`}>
                      {n.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/login" className={`${link} w-full text-brand-text`}>
                    {t("nav.signin")}
                  </Link>
                </li>
                <li className="sm:hidden">
                  <Link href="/signup" className={`${link} w-full font-semibold text-brand-text`}>
                    {t("nav.start")}
                  </Link>
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
