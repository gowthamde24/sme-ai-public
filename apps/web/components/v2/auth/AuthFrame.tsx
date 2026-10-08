import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { container } from "@/components/v2/landing/ui";
import { V2Root } from "@/components/v2/V2Root";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import { authT } from "@/i18n/auth";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";

/**
 * The frame around the sign-in and account screens (Stage 3): skip link, header with the wordmark, the language select and
 * the theme button, the side panel from `md` up, and the way back. It is rendered ONLY by the two route layouts
 * (app/login/layout.tsx and app/auth/layout.tsx), never inside a page: the pages' existing tests render the pages
 * directly, and an async component that reads cookies and loads fonts cannot render there (port-design-v2-stage3-risk-check.md).
 *
 * It reads the two functional preference cookies and nothing else: no session, no redirect, no data. The chrome is in the
 * visitor's language; the form region is the page's own <main> and stays in English (lang="en"), because the form words,
 * headings and messages are today's (owner decision 1). It contains no <form> and no <main>.
 */
export async function AuthFrame({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const lang = readLang(jar.get(LANG_COOKIE)?.value);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const t = authT(lang);
  return (
    <V2Root theme={theme} lang={lang} className="min-h-dvh">
      <div data-screen="auth" className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal"
        >
          {t("skip")}
        </a>
        <header className="border-b border-line bg-bg/90">
          <div className={`${container} flex min-h-16 items-center gap-3 py-2`}>
            <Link href="/" className="rounded-md" aria-label={`${BRAND_NAME}: ${t("home")}`}>
              <Wordmark />
            </Link>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <LangSelect lang={lang} label={t("lang.label")} />
              <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
            </div>
          </div>
        </header>
        <div className={`${container} grid flex-1 items-center gap-10 py-8 md:grid-cols-2 md:py-14`}>
          <aside className="hidden md:block">
            <p className="text-balance font-display text-4xl font-bold leading-tight">{t("side.title")}</p>
            <p className="mt-4 text-lg text-muted">{t("side.d")}</p>
            <p className="mt-6 inline-block rounded-md bg-brand-bg px-3 py-1 text-base font-semibold text-brand-text">{t("side.note")}</p>
          </aside>
          <div>
            <div lang="en">{children}</div>
            <p className="mt-6 text-center">
              <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-brand-text hover:underline">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("home")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </V2Root>
  );
}
