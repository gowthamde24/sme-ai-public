"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu } from "./AccountMenu";
import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { HelpButton } from "./help/HelpButton";
import { FeelParts } from "./feel/LazyFeel";
import { LiveBar, LiveIsland, LivePing } from "./live/LazyLiveCalls";
import { NotificationBell } from "./notify/NotificationBell";
import { BrandMark } from "./frame-parts";
import { word, type Labels } from "./labels";
import { TopSearch } from "./LazyTopSearch";
import type { PaletteSetup } from "./TopSearch";
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * The bar across the top of the page: on a phone the orange mark (to the home of the workspace; the narrowest phones, under 380px, give its place to the controls, the bottom bar has Today) on the left; on the right the language and the light/dark controls
 * (`children`, drawn by the server in the chosen language). Outside a workspace the phone has no bottom bar, so the user menu sits here instead.
 * Sidebar v2: in a workspace a desktop has "Search or ask anything ⌘K" and a phone a search button; both (and ⌘K / Ctrl+K) open the command palette (owner, 6 Nov 2026), never the assistant on its own; the bar is solid at the top of the page and frosted (`.v2-glass`, with its solid fallback) once the page scrolls under it.
 */
export function TopBar({ memberships, labels, email, signOut, mark, children, palette = null, still = false, frame: given = null }: { memberships: readonly Membership[]; labels?: Labels; email: string | null; signOut: () => Promise<void>; mark: ReactNode; children: ReactNode; /** The command palette's words (palette/names.ts); null = no palette (a frame drawn without them, a test). */ palette?: PaletteSetup | null; /** The demo video (job demo-video): the bell asks nothing and shows no count. */ still?: boolean; /** The frame (app v4 reads it: on a phone the person and Sign out move here from "More", which v4 does not have). */ frame?: FrameData | null }) {
  const { current } = useWorkspace(memberships);
  const frame = useFrameData(given ?? ({} as FrameData));
  const v4 = frame?.v4 === true;
  return (
    <header data-scrolled="false" className={`print:hidden sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-transparent bg-bg px-4 md:px-8${v4 && current ? " max-md:flex-wrap" : ""}`}>
      {/* app v4: while a call is live, the dark pill (phone: the first row; desktop: in the group on the right) and the first question about "a call started" notifications */}
      {v4 && current ? <LiveIsland tenantId={current.id} labels={labels} enabled /> : null}
      {v4 && current ? <LivePing tenantId={current.id} labels={labels} enabled /> : null}
      <Link href={current ? `/app/tenants/${current.id}` : "/app"} className={current ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg max-[380px]:hidden md:hidden" : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg md:hidden"} aria-label={current?.name ?? "Home"}>
        <BrandMark px={32} />
      </Link>
      {current && palette ? <TopSearch label={word(labels, "frame.search", "Search or ask anything")} memberships={memberships} labels={labels} palette={palette} who={email ?? ""} sidebarAtLg={v4} /> : null}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* "Start demo" (a demo workspace only) is drawn here by the guided demo */}
        <span id="demo-start-slot" className="contents" />
        {v4 && current ? <FeelParts tenantId={current.id} labels={labels} /> : null}
        {v4 && current ? <LiveBar tenantId={current.id} labels={labels} enabled /> : null}
        {current ? (
          <span className={v4 ? "max-md:hidden" : "contents"}>
            <HelpButton base={`/app/tenants/${current.id}`} labels={labels} />
          </span>
        ) : null}
        {current ? <NotificationBell key={current.id} tenantId={current.id} labels={labels} still={still} /> : null}
        <span className={v4 ? "contents max-md:hidden" : "contents"}>{children}</span>
        {current && !v4 ? null : (
          <div className="md:hidden">
            <AccountMenu
              email={email}
              signOut={signOut}
              labels={labels}
              down
              several={memberships.length > 1}
              mark={mark}
              extra={
                v4 && current ? (
                  <div className="flex flex-col gap-2 border-y border-line px-3 py-2" data-part="person-menu-extra">
                    <div className="flex flex-wrap items-center gap-2">{children}</div>
                    <Link href={`/app/tenants/${current.id}/help`} className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline-offset-4 hover:underline">
                      {word(labels, "frame.help", "Help")}
                    </Link>
                  </div>
                ) : null
              }
            />
          </div>
        )}
      </div>
    </header>
  );
}

