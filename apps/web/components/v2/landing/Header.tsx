import Link from "next/link";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { container } from "@/components/v2/landing/ui";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import type { LandingKey, LandingT } from "@/i18n/landing";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

const NAV: [string, LandingKey][] = [
  ["#how", "nav.how"],
  ["#control", "nav.control"],
  ["#team", "nav.team"],
  ["#languages", "nav.languages"],
  ["#privacy", "nav.privacy"],
  ["#faq", "nav.faq"],
];

export function Header({ t, lang, theme }: { t: LandingT; lang: Lang; theme?: Theme }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className={`${container} flex min-h-16 items-center gap-3 py-2`}>
        <a href="#top" className="rounded-md" aria-label={BRAND_NAME}>
          <Wordmark />
        </a>
        <nav aria-label={t("nav.sections")} className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map(([href, k]) => (
            <a key={href} href={href} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-2">
              {t(k)}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href="/login" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-1.5 text-sm font-semibold text-brand-text hover:underline sm:px-3">
            {t("nav.signin")}
          </Link>
          <LangSelect lang={lang} label={t("lang.label")} />
          <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
        </div>
      </div>
    </header>
  );
}
