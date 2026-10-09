import Link from "next/link";
import type { ReactNode } from "react";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { V2Root } from "@/components/v2/V2Root";
import { Wordmark } from "@/components/v2/Wordmark";
import { BRAND_NAME } from "@/design/brand";
import { appT, frameLabels } from "@/i18n/app";
import { authT } from "@/i18n/auth";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

import { AccountMenu } from "./AccountMenu";
import { Crumbs } from "./Crumbs";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import type { Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/**
 * The frame of every screen under /app (workspace redesign, Batch 1A): skip link, top bar (wordmark, workspace name with a switcher, language,
 * theme, account menu), the menu beside the page (768px and up), the bottom bar (phone), and the way back. It is rendered ONLY by app/app/layout.tsx,
 * never inside a page: page tests render pages directly, and this reads cookies.
 *
 * One v2 wrapper holds the whole frame AND the page (the clean-up batch: every screen is in the v2 look, so there are no islands any more). The page keeps its own
 * <main>. The page's words are English (the language track translates them screen by screen), so the page area says lang=en; the frame's own words,
 * the skip link and the language and theme controls carry the chosen language (language track L0: every non-English word there is a machine draft, a note
 * says so, and the three menu items about money rules, privacy and erasure stay English until a person reviews them).
 * It decides no access: `memberships` only says which menu items to offer; a page, the API and the database stay the gate.
 * `memberships` null = the API could not be read: the account part only.
 */
export function AppFrame({ lang, theme, email, memberships, signOut, children }: { lang: Lang; theme: Theme | undefined; email: string | null; memberships: readonly Membership[] | null; signOut: () => Promise<void>; children: ReactNode }) {
  const t = authT(lang);
  const list = memberships ?? [];
  const labels = frameLabels(lang);
  return (
    <V2Root theme={theme} lang={lang} className="min-h-dvh">
      <div data-frame="app" className="flex min-h-dvh flex-col">
        <a href="#main-content" lang={lang} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("skip")}
        </a>
        <div className="sticky top-0 z-40 border-b border-line bg-bg">
          <header>
            <div className="flex min-h-16 items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6">
              <Link href="/app" className="hidden shrink-0 rounded-md sm:block" aria-label={`${BRAND_NAME}: your workspaces`}>
                <Wordmark />
              </Link>
              <div className="min-w-0 flex-1 sm:ml-3">
                <WorkspaceSwitcher memberships={list} labels={labels} />
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <span lang={lang}>
                  <LangSelect lang={lang} label={t("lang.label")} />
                </span>
                <span lang={lang}>
                  <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
                </span>
                <AccountMenu email={email} signOut={signOut} labels={labels} />
              </div>
            </div>
          </header>
          {lang !== "en" ? (
            <p role="note" lang={lang} className="border-t border-line px-4 py-1.5 text-sm text-muted sm:px-6">
              {appT(lang)("frame.draft")}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 md:items-stretch">
          <div className="hidden w-64 shrink-0 border-r border-line md:has-[nav]:block lg:w-72">
            <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto">
              <SideNav memberships={list} labels={labels} />
            </div>
          </div>
          <div className="min-w-0 flex-1 pb-20 md:pb-0">
            <Crumbs memberships={list} labels={labels} />
            <div id="main-content" lang="en" tabIndex={-1} className="outline-none">
              {children}
            </div>
          </div>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
          <TabBar memberships={list} labels={labels} />
        </div>
      </div>
    </V2Root>
  );
}
