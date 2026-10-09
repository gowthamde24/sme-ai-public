import type { ReactNode } from "react";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { V2Root } from "@/components/v2/V2Root";
import { appT, frameLabels } from "@/i18n/app";
import { authT } from "@/i18n/auth";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

import { FRAME_LOADING, type FrameData } from "./contract";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";
import type { Membership } from "./use-workspace";

/**
 * The frame of every screen under /app, as the design-lab app draws it (Job AC, batch C1): skip link, the menu beside the page (768px and up: the business and its plan,
 * the groups, the AI usage card, Settings, Help, the user card, "Collapse menu"), the top bar (language and light/dark; the orange mark on a phone), the bottom bar
 * with its More sheet (phone) and the way back. It is rendered ONLY by app/app/layout.tsx, never inside a page: page tests render pages directly, and this reads cookies.
 *
 * One v2 wrapper holds the whole frame AND the page. The page keeps its own <main>. The page's words are English (the language track translates them screen by screen),
 * so the page area says lang=en; the frame's own words, the skip link and the language and theme controls carry the chosen language (every non-English word there is a machine
 * draft, a note says so, and the strings about money, consent, privacy and safety stay English until a person reviews them).
 * It decides no access: `memberships` only says which menu items to offer; a page, the API and the database stay the gate. `memberships` null = the API could not be read:
 * the account part only. `frame` = what the frame shows until the workspace's own layout brings in the plan, the AI usage and the count on Today (frame-store.ts); a part that cannot be read says "Not available yet".
 */
export function AppFrame({ lang, theme, email, memberships, signOut, frame = FRAME_LOADING, children }: { lang: Lang; theme: Theme | undefined; email: string | null; memberships: readonly Membership[] | null; signOut: () => Promise<void>; frame?: FrameData; children: ReactNode }) {
  const t = authT(lang);
  const list = memberships ?? [];
  const labels = frameLabels(lang);
  return (
    <V2Root theme={theme} lang={lang} className="min-h-dvh">
      <div data-frame="app" className="flex min-h-dvh w-full">
        <a href="#main-content" lang={lang} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("skip")}
        </a>
        <SideNav memberships={list} labels={labels} frame={frame} email={email} signOut={signOut} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar memberships={list} labels={labels} email={email} signOut={signOut}>
            <span lang={lang}>
              <LangSelect lang={lang} label={t("lang.label")} />
            </span>
            <span lang={lang}>
              <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
            </span>
          </TopBar>
          {lang !== "en" ? (
            <p role="note" lang={lang} className="border-b border-line px-4 py-1.5 text-sm text-muted md:px-8">
              {appT(lang)("frame.draft")}
            </p>
          ) : null}
          <div id="main-content" lang="en" tabIndex={-1} className="min-w-0 flex-1 pb-20 outline-none md:pb-0">
            {children}
          </div>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
          <TabBar memberships={list} labels={labels} frame={frame} email={email} signOut={signOut} />
        </div>
      </div>
    </V2Root>
  );
}
