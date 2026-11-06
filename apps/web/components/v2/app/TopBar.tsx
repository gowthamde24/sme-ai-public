"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu } from "./AccountMenu";
import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { HelpButton } from "./help/HelpButton";
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
    <header data-scrolled="false" className="print:hidden sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-transparent bg-bg px-4 md:px-8">
      <Link href={current ? `/app/tenants/${current.id}` : "/app"} className={current ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg max-[380px]:hidden md:hidden" : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg md:hidden"} aria-label={current?.name ?? "Home"}>
        <BrandMark px={32} />
      </Link>
      {current && palette ? <TopSearch label={word(labels, "frame.search", "Search or ask anything")} memberships={memberships} labels={labels} palette={palette} who={email ?? ""} /> : null}
      <div className="ml-auto flex items-center gap-2">
        {/* "Start demo" (a demo workspace only) is drawn here by the guided demo */}
        <span id="demo-start-slot" className="contents" />
        {current ? <HelpButton base={`/app/tenants/${current.id}`} labels={labels} /> : null}
        {current ? <NotificationBell key={current.id} tenantId={current.id} labels={labels} still={still} /> : null}
        {children}
        {current && !v4 ? null : (
          <div className="md:hidden">
            <AccountMenu email={email} signOut={signOut} labels={labels} down several={memberships.length > 1} mark={mark} />
          </div>
        )}
      </div>
    </header>
  );
}

/** App v4 on a phone: the light/dark button gives its place to the person (whose menu moved here from "More"); Settings > Language and look keeps the choice. Without v4, or from a tablet up, it is drawn as before. */
export function HideOnPhoneInV4({ frame: given, children }: { frame: FrameData; children: ReactNode }) {
  const frame = useFrameData(given);
  return frame.v4 ? <span className="max-md:hidden">{children}</span> : <>{children}</>;
}
