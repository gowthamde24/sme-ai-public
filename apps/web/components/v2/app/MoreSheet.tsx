"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import type { NavCounts } from "@/lib/nav-counts";

import { PoweredBy } from "./frame-parts";
import { SpriteIcon } from "./icons";
import { NavGroups } from "./NavGroups";
import { NavMeters } from "./NavMeters";
import { word, type Labels } from "./labels";
import { ADMINS, type MenuGroup } from "./nav";
import type { Membership } from "./use-workspace";

const row = "flex min-h-12 w-full items-center gap-3 rounded-lg border border-line px-3 text-left text-base font-medium transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line";

/**
 * The phone's More sheet (sidebar v2), its own chunk: it is drawn only after "More" is pressed, so no page's first load carries it (the route-JS budget). Every row of the menu that is not a tab of the bar, in its groups, the two
 * meters and "Top up · Plan & usage · Help", the person, the workspaces and Sign out. Frosted glass (solid where the browser cannot blur or the person asked for less transparency). The close button takes the focus; Escape closes it.
 */
export function MoreSheet({ current, memberships, email, signOut, accountMark, labels, rest, activeMenu, waiting, counts, own, onClose }: { current: Membership; memberships: readonly Membership[]; email: string | null; signOut: () => Promise<void>; accountMark: ReactNode; labels?: Labels; rest: readonly MenuGroup[]; activeMenu: string | null; waiting: number | null; counts: NavCounts; own: Readonly<Record<string, string>>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
        <div className="fixed inset-0 z-50">
          <div aria-hidden="true" className="absolute inset-0 bg-charcoal/50" onClick={onClose} />
          <div role="dialog" aria-modal="true" aria-label={word(labels, "frame.menu.all", "All of the menu")} data-more-sheet="" className="v2-glass absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-line shadow-[var(--v2-shadow-pop)]">
            <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-bold">{word(labels, "frame.more", "More")}</p>
                <p className="truncate text-sm text-muted">{current.name}</p>
              </div>
              <button ref={closeRef} type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface" aria-label={word(labels, "frame.close", "Close the menu")}>
                <SpriteIcon id="x" />
              </button>
            </div>
            <div className="space-y-5 px-4 pb-8 pt-5">
              <div className="flex items-center gap-3">
                {accountMark}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{email ?? word(labels, "frame.account", "Your account")}</p>
                  <p className="text-sm capitalize text-muted">{current.role}</p>
                </div>
              </div>
              <NavGroups groups={rest} tenantId={current.id} activeItemId={activeMenu} labels={labels} waiting={waiting} counts={counts} onNavigate={onClose} own={own} foldable={false} />
              <div className="rounded-xl border border-line bg-surface py-1">
                <NavMeters counts={counts} tenantId={current.id} labels={labels} manages={(ADMINS as readonly string[]).includes(current.role)} onNavigate={onClose} />
              </div>
              {memberships.length > 1 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{word(labels, "frame.yourworkspaces", "Your workspaces")}</p>
                  {memberships.map((m) => (
                    <Link key={m.id} href={`/app/tenants/${m.id}`} aria-current={m.id === current.id ? "true" : undefined} onClick={onClose} className={`${row} justify-between`}>
                      <span className="min-w-0 truncate">{m.name}</span>
                      <span className="text-sm font-normal capitalize text-muted">{m.role}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              <form action={signOut}>
                <button type="submit" className={`${row} text-red-text`}>
                  <SpriteIcon id="log-out" />
                  {word(labels, "frame.signout", "Sign out")}
                </button>
              </form>
              <PoweredBy labels={labels} />
            </div>
          </div>
        </div>
  );
}
