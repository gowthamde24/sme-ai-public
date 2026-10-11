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
import { legalT } from "@/i18n/legal";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";

import { LegalLinks } from "./LegalLinks";

/**
 * The frame of the Privacy and Terms pages (job BH): skip link, header (wordmark, language, theme), the page, and a footer with the legal links. Rendered ONLY by the route layout (app/(legal)/layout.tsx),
 * like AuthFrame: it reads the two preference cookies and loads fonts, so a page test cannot render it. It is public: no session, no data.
 */
export async function LegalFrame({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const lang = readLang(jar.get(LANG_COOKIE)?.value);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const t = legalT(lang);
  return (
    <V2Root theme={theme} lang={lang} className="min-h-dvh">
      <div data-screen="legal" className="flex min-h-dvh flex-col">
        <a href="#main" lang={lang} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("legal.skip")}
        </a>
        <header className="border-b border-line bg-bg/90">
          <div className={`${container} flex min-h-16 items-center gap-3 py-2`}>
            <Link href="/" className="rounded-md" aria-label={`${BRAND_NAME}: ${t("legal.back")}`}>
              <Wordmark />
            </Link>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <LangSelect lang={lang} label={t("legal.lang.label")} />
              <ThemeButton initial={theme} toDark={t("legal.theme.toDark")} toLight={t("legal.theme.toLight")} />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className={`${container} w-full max-w-[860px] flex-1 py-8 outline-none sm:py-12`}>
          {children}
          <p className="mt-10">
            <Link href="/" lang={lang} className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-brand-text hover:underline">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("legal.back")}
            </Link>
          </p>
        </main>
        <footer className="border-t border-line bg-surface">
          <LegalLinks lang={lang} className={`${container} py-4`} />
        </footer>
      </div>
    </V2Root>
  );
}
