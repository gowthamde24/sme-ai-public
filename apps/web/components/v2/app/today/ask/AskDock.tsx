"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { useCollapsed } from "../../use-collapsed";
import type { AskWords } from "./ask-words";

/** The same component as Today's, in a chunk of its own: the dock is on many screens, and the route-JS budget counts what a page loads at first (the chunk comes when the page is idle or the person reaches for the line). */
const AskTeam = dynamic(() => import("./AskTeam").then((m) => m.AskTeam), { ssr: false });

/** The screens of the menu that get the dock: the list screens, one level under the workspace. Today has the line in its own card; settings, forms, a single record and the live call have their own bottom bars or need the whole screen. */
const DOCK_SCREENS = new Set(["review", "leads", "quotes", "enquiries", "visits", "orders", "outbox", "chats", "report", "companies", "contacts", "customers", "catalogue", "materials", "campaigns", "call-list", "office", "fees", "students", "admissions", "announcements", "dues", "sites", "retailers", "programmes"]);

/** Whether the dock belongs on this address: `/app/tenants/<id>/<screen>` and nothing deeper. */
export function dockScreen(pathname: string | null, base: string): boolean {
  if (!pathname || !pathname.startsWith(`${base}/`)) return false;
  const parts = pathname.slice(base.length + 1).split("/").filter(Boolean);
  return parts.length === 1 && DOCK_SCREENS.has(parts[0]);
}

const bar = "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-line bg-bg px-4 py-2.5 md:inset-x-auto md:right-6 md:bottom-4 md:rounded-[18px] md:border md:bg-surface md:px-3 md:py-2 md:shadow-[0_10px_30px_rgba(30,30,36,0.08)]";

/** What is drawn until the line itself has arrived: the same bar, nothing to press (no dead button), the person's own placeholder. */
function Waiting({ placeholder, left }: { placeholder: string; left: string }) {
  return (
    <div aria-hidden="true" data-dock="waiting" className={`${bar} ${left}`}>
      <Orb px={32} state="still" />
      <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-full border border-edge bg-bg px-5 text-base text-muted md:min-h-14">{placeholder}</div>
      <div className="size-12 shrink-0 rounded-full bg-brand md:size-14" />
    </div>
  );
}

/**
 * The Ask dock (job DN): the question line of Today (the `hero` variant of AskTeam: the same component, the same words, the same answers) at the bottom of the main screens, so a person can ask without going back to Today.
 * It is only drawn when the assistant can be asked (the server leaves it out otherwise). The answer opens in a sheet above the line, at most 60% of the screen high, and the page keeps room under its last row.
 */
export function AskDock({ lang, base, words }: { lang: string; base: string; words: AskWords }) {
  const pathname = usePathname();
  const [menuCollapsed] = useCollapsed();
  const [ready, setReady] = React.useState(false);
  const here = dockScreen(pathname, base);
  React.useEffect(() => {
    if (!here) return;
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const id = idle ? idle(() => setReady(true)) : window.setTimeout(() => setReady(true), 1200);
    return () => (idle ? (window as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id) : window.clearTimeout(id));
  }, [here]);
  if (!here) return null;
  const left = menuCollapsed ? "md:left-[calc(72px+1.5rem)]" : "md:left-[calc(16rem+1.5rem)]";
  return (
    <>
      <div aria-hidden="true" data-dock="room" className="h-20 md:h-24 print:hidden" />
      <div
        data-dock="ask"
        className={`pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+4.5rem)] z-30 px-4 print:hidden md:inset-x-auto md:right-6 md:bottom-[calc(1rem+4.5rem+0.5rem)] md:px-0 ${left}`}
      >
        <div className="pointer-events-auto max-h-[60vh] overflow-y-auto rounded-2xl [&_[aria-live=polite]]:mt-0 [&_[aria-live=polite]]:border-t-0 [&_[aria-live=polite]]:pt-0 has-[[aria-live=polite]]:border has-[[aria-live=polite]]:border-line has-[[aria-live=polite]]:bg-surface has-[[aria-live=polite]]:p-4 has-[[aria-live=polite]]:shadow-[0_10px_30px_rgba(30,30,36,0.12)]">
          {ready ? <AskTeam variant="hero" dock lang={lang} base={base} availability="live" words={words} chips={[]} /> : <Waiting placeholder={words["ask.placeholder.hero"] ?? ""} left={left} />}
        </div>
      </div>
    </>
  );
}
