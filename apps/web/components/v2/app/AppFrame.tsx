import type { ReactNode } from "react";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeButton } from "@/components/v2/controls/ThemeButton";
import { LegalLinks } from "@/components/v2/legal/LegalLinks";
import { InstallHint } from "@/components/v2/pwa/LazyInstallHint";
import { V2Root } from "@/components/v2/V2Root";
import { appT, frameLabels } from "@/i18n/app";
import { authT } from "@/i18n/auth";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

import { Avatar } from "./Avatar";
import { FRAME_LOADING, type FrameData } from "./contract";
import { GroupTabs } from "./GroupTabs";
import { lettersOf } from "./letters";
import { UsageBanner } from "./UsageBanner";
import { LabelsProvider } from "./robust/labels-context";
import { RobustShell } from "./robust/RobustShell";
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
/** The sizes of the round mark (the menu footer and the phone's menu sheet): the layout draws the person's own with the same classes. */
export const MARK_SMALL = "grid size-9 shrink-0 place-items-center rounded-full bg-charcoal text-sm font-semibold text-on-charcoal";
export const MARK_LARGE = "grid size-12 shrink-0 place-items-center rounded-full bg-charcoal font-semibold text-on-charcoal";

export function AppFrame({ lang, theme, email, memberships, signOut, frame = FRAME_LOADING, mark, markLarge, children }: { lang: Lang; theme: Theme | undefined; email: string | null; memberships: readonly Membership[] | null; signOut: () => Promise<void>; frame?: FrameData; /** The person's round mark (picture over letters) drawn by the layout on the server: slots, so the picture adds no script to any page. */ mark?: ReactNode; markLarge?: ReactNode; children: ReactNode }) {
  const t = authT(lang);
  const list = memberships ?? [];
  const labels = frameLabels(lang);
  // the round marks of the account menu: the person's own (picture over letters) when the layout read their profile, else the letters of the e-mail address
  const small = mark ?? <Avatar url={null} letters={lettersOf(null, email)} className={MARK_SMALL} />;
  const large = markLarge ?? <Avatar url={null} letters={lettersOf(null, email)} className={MARK_LARGE} />;
  return (
    <V2Root theme={theme} lang={lang} className="min-h-dvh">
      <div data-frame="app" className="flex min-h-dvh w-full">
        <a href="#main-content" lang={lang} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("skip")}
        </a>
        <SideNav memberships={list} labels={labels} frame={frame} email={email} signOut={signOut} mark={small} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar memberships={list} labels={labels} email={email} signOut={signOut} mark={small}>
            <span lang={lang}>
              <LangSelect lang={lang} label={t("lang.label")} />
            </span>
            <span lang={lang}>
              <ThemeButton initial={theme} toDark={t("theme.toDark")} toLight={t("theme.toLight")} />
            </span>
          </TopBar>
          <RobustShell labels={labels} />
          {lang !== "en" ? (
            <div role="region" aria-label={appT(lang)("frame.draft.label")} lang={lang} className="border-b border-line px-4 py-1.5 text-sm text-muted md:px-8 print:hidden">
              {appT(lang)("frame.draft")}
            </div>
          ) : null}
          <div id="main-content" lang="en" tabIndex={-1} className="min-w-0 flex-1 outline-none">
            <UsageBanner memberships={list} labels={labels} frame={frame} />
            <GroupTabs memberships={list} labels={labels} frame={frame} />
            <LabelsProvider labels={labels}>{children}</LabelsProvider>
          </div>
          {/* Privacy Policy, Terms and Cookie settings (job BH); above the bottom bar on a phone, with room for the floating orb (56px + 16px) under the last thing on the page */}
          <footer data-frame="legal" className="border-t border-line px-4 pb-[calc(5rem+72px)] pt-1 md:px-8 md:pb-2 print:hidden">
            <LegalLinks lang={lang} />
          </footer>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden print:hidden">
          <InstallHint labels={labels} />
          <TabBar memberships={list} labels={labels} frame={frame} email={email} signOut={signOut} mark={large} />
        </div>
      </div>
    </V2Root>
  );
}
