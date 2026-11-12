"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ComponentProps } from "react";

import { NO_COUNTS, type NavCounts } from "@/lib/nav-counts";

import { NavIcon, SpriteIcon } from "./icons";
import { word, type Labels } from "./labels";
import { badgeOf, badgeOfDesign, type Badge } from "./nav-badges";
import { hrefOf, type MenuGroup, type MenuRow, type NavItem, type PackFrame } from "./nav";
import { ownWords, rowWord } from "./nav-words";

export { ownWords, rowWord };

export const itemBase = "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out";
export const itemIdle = "text-ink hover:bg-surface-2 active:bg-line";
export const itemCurrent = "bg-brand-bg text-brand-text";

const TONE: Record<Badge["tone"], string> = {
  brand: "min-w-6 justify-center bg-brand text-on-brand",
  green: "bg-green-bg text-green-text",
  quiet: "bg-surface-2 text-muted",
  soft: "bg-brand-bg text-brand-text",
};

/** One menu row: icon, word (it wraps, it is never cut), the orange mark when it is the current page, and its badge. `collapsed` = the narrow rail: the icon only (the word stays for a screen reader), a badge becomes a dot. */
/**
 * A `Link` that is prefetched only when the person shows intent (a pointer or a finger comes over it, or it gets keyboard focus), not as soon as it is on screen.
 * Staging, 12 Nov 2026: one Today load made the browser prefetch about 40 routes (every menu link, twice), each a full server render of that route's layout with its reads of the API; they ran in front of the person's next click and used the
 * API's capacity during calls. `prefetch={false}` never prefetches (not on hover either, Next 16), so this turns it on for the ONE link the person is about to use. It owns `onPointerEnter` and `onFocus` (its callers pass neither).
 */
export function IntentLink(props: ComponentProps<typeof Link>) {
  const [warm, setWarm] = useState(false);
  const on = () => setWarm(true);
  return <Link {...props} prefetch={warm ? null : false} onPointerEnter={on} onFocus={on} />;
}

export function NavLink({ item, tenantId, on, labels, badge = null, collapsed = false, onNavigate, own = {} }: { item: MenuRow | NavItem; tenantId: string; on: boolean; labels?: Labels; badge?: Badge | null; collapsed?: boolean; onNavigate?: () => void; own?: Readonly<Record<string, string>> }) {
  const text = rowWord(item, labels, own);
  return (
    <IntentLink href={hrefOf(item, tenantId)} aria-current={on ? "page" : undefined} title={collapsed ? text : undefined} onClick={onNavigate} data-nav-row={item.id} className={`${itemBase} ${collapsed ? "justify-center px-0" : ""} ${on ? itemCurrent : itemIdle}`}>
      {on ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-edge" /> : null}
      <NavIcon name={item.icon} />
      <span data-nav-label="" className={collapsed ? "sr-only" : "min-w-0 flex-1 py-1 leading-snug [overflow-wrap:anywhere]"}>{text}</span>
      {badge ? (
        collapsed ? (
          <span data-nav-badge={item.id} className={`absolute right-2 top-2 size-2 rounded-full ${badge.tone === "green" ? "bg-green-text" : "bg-brand-edge"}`}>
            <span className="sr-only">{badge.text}</span>
          </span>
        ) : badge.dot ? (
          <span data-nav-badge={item.id} className="inline-flex size-6 shrink-0 items-center justify-center">
            <span aria-hidden="true" className="lv-dot" data-live-dot="" />
            <span className="sr-only">{badge.text}</span>
          </span>
        ) : (
          <span data-nav-badge={item.id} className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-semibold tabular-nums ${TONE[badge.tone]}`}>
            {badge.tone === "green" && item.id === "m-calls" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-green-text" /> : null}
            {badge.text}
          </span>
        )
      ) : null}
    </IntentLink>
  );
}

const FOLD_KEY = "sme_nav_folded";
const foldListeners = new Set<() => void>();
function subscribeFold(notify: () => void) {
  foldListeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    foldListeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}
/** The folded groups as the stored text ("[]" without storage): a string, so the snapshot is stable between reads. */
function foldSnapshot(): string {
  try {
    return window.localStorage.getItem(FOLD_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseFolded(text: string): string[] {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
let foldedHere: string[] | null = null; // a private window: the fold lasts for this page only
function storeFolded(next: string[]) {
  try {
    window.localStorage.setItem(FOLD_KEY, JSON.stringify(next));
  } catch {
    foldedHere = next;
  }
  foldListeners.forEach((l) => l());
}
const readFoldedHere = () => foldedHere;

/**
 * The menu (sidebar v2): the groups OVERVIEW, SELL, BUSINESS, AI TEAM and SETUP, each with its heading; a heading folds its group (remembered in this browser; the group of the current page never folds away). One drawing for the
 * side menu and the phone's More sheet. `counts` = C1's nav-counts (every number null until they arrive: no badges); `waiting` = the frame's own Today count, used until they do.
 */
export function NavGroups({ groups, tenantId, activeItemId, labels, waiting = null, counts = NO_COUNTS, collapsed = false, onNavigate, own = {}, foldable = true, design = false }: { /** app v4's desktop menu (owner, 7 Nov 2026): small plain headings that never fold, and the design's chips (a number, a dot for a live call, "N new"). */ design?: boolean; groups: readonly MenuGroup[]; tenantId: string; activeItemId: string | null; labels?: Labels; waiting?: number | null; counts?: NavCounts; collapsed?: boolean; onNavigate?: () => void; /** The business type's own words (`ownWords`). */ own?: Readonly<Record<string, string>>; foldable?: boolean }) {
  // the folded groups of this browser (the first, server render: none)
  const text = useSyncExternalStore(subscribeFold, foldSnapshot, () => "[]");
  const folded = foldable && !design ? (readFoldedHere() ?? parseFolded(text)) : [];
  const toggle = (id: string) => storeFolded(folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id]);
  const say = (key: string, fallback: string, vars: Record<string, string | number>) => word(labels, key, fallback, vars);
  return (
    <div className="space-y-2">
      {groups.map((g, gi) => {
        const heading = word(labels, `nav.group.${g.id}`, g.label);
        const holdsCurrent = g.items.some((i) => i.id === activeItemId);
        // app v4's one group has no heading, so it never folds
        const isFolded = foldable && g.label !== "" && !collapsed && folded.includes(g.id) && !holdsCurrent;
        return (
          <div key={g.id} role="group" aria-label={heading} data-nav-group={g.id}>
            {g.label === "" ? null : collapsed ? (
              gi > 0 ? <hr className="mx-3 my-1 border-line" /> : null
            ) : foldable && !design ? (
              <button type="button" onClick={() => toggle(g.id)} aria-expanded={!isFolded} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">
                <span className="min-w-0 text-left [overflow-wrap:anywhere]">{heading}</span>
                <SpriteIcon id="chevron-down" className={`size-4 shrink-0 transition-transform duration-150 ${isFolded ? "-rotate-90" : ""}`} />
              </button>
            ) : (
              <p aria-hidden="true" className={design ? "px-3 pb-0 pt-2 text-xs font-medium text-muted" : "px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted"}>
                {heading}
              </p>
            )}
            {isFolded ? null : (
              <div className="space-y-0.5">
                {g.items.map((i) => (
                  <NavLink key={i.id} item={i} tenantId={tenantId} on={activeItemId === i.id} labels={labels} badge={(design ? badgeOfDesign : badgeOf)(i.count, counts, waiting, say)} collapsed={collapsed} onNavigate={onNavigate} own={own} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
