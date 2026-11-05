"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { NO_COUNTS, type NavCounts } from "@/lib/nav-counts";

import { NavIcon, SpriteIcon } from "./icons";
import { word, type Labels } from "./labels";
import { badgeOf, type Badge } from "./nav-badges";
import { FOOT, NAV, hrefOf, type MenuGroup, type MenuRow, type NavItem, type PackFrame } from "./nav";

export const itemBase = "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out";
export const itemIdle = "text-ink hover:bg-surface-2 active:bg-line";
export const itemCurrent = "bg-brand-bg text-brand-text";

const TONE: Record<Badge["tone"], string> = {
  brand: "min-w-6 justify-center bg-brand text-on-brand",
  green: "bg-green-bg text-green-text",
  quiet: "bg-surface-2 text-muted",
};

/** The app's English word of each page (the menu table's), for a frame drawn without its words (a test). */
const PAGE_WORDS: Readonly<Record<string, string>> = Object.fromEntries([...NAV.flatMap((g) => g.items), ...FOOT].map((p) => [`nav.item.${p.id}`, p.label]));

/** The business type's words that are its OWN: those that differ from the app's word for the same key (a pack that calls its catalogue "Catalogue" has no word of its own for it). */
export function ownWords(pack: PackFrame | null | undefined, plain: Labels | undefined): Readonly<Record<string, string>> {
  if (!pack) return {};
  return Object.fromEntries(Object.entries(pack.labels).filter(([k, v]) => v !== (plain?.[k] ?? PAGE_WORDS[k])));
}

/** A row's word: the business type's own word for its page when it has one ("Campus visits", "Materials"), else the row's word ("Catalogue & stock"). */
export function rowWord(item: NavItem & { labelOf?: string }, labels: Labels | undefined, own: Readonly<Record<string, string>> | undefined): string {
  const mine = item.labelOf ? own?.[`nav.item.${item.labelOf}`] : undefined;
  return mine ?? word(labels, `nav.item.${item.id}`, item.label);
}

/** One menu row: icon, word (it wraps, it is never cut), the orange mark when it is the current page, and its badge. `collapsed` = the narrow rail: the icon only (the word stays for a screen reader), a badge becomes a dot. */
export function NavLink({ item, tenantId, on, labels, badge = null, collapsed = false, onNavigate, own = {} }: { item: MenuRow | NavItem; tenantId: string; on: boolean; labels?: Labels; badge?: Badge | null; collapsed?: boolean; onNavigate?: () => void; own?: Readonly<Record<string, string>> }) {
  const text = rowWord(item, labels, own);
  return (
    <Link href={hrefOf(item, tenantId)} aria-current={on ? "page" : undefined} title={collapsed ? text : undefined} onClick={onNavigate} data-nav-row={item.id} className={`${itemBase} ${collapsed ? "justify-center px-0" : ""} ${on ? itemCurrent : itemIdle}`}>
      {on ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-edge" /> : null}
      <NavIcon name={item.icon} />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 py-1 leading-snug [overflow-wrap:anywhere]"}>{text}</span>
      {badge ? (
        collapsed ? (
          <span data-nav-badge={item.id} className={`absolute right-2 top-2 size-2 rounded-full ${badge.tone === "green" ? "bg-green-text" : "bg-brand-edge"}`}>
            <span className="sr-only">{badge.text}</span>
          </span>
        ) : (
          <span data-nav-badge={item.id} className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-semibold tabular-nums ${TONE[badge.tone]}`}>
            {badge.tone === "green" && item.id === "m-calls" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-green-text" /> : null}
            {badge.text}
          </span>
        )
      ) : null}
    </Link>
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
export function NavGroups({ groups, tenantId, activeItemId, labels, waiting = null, counts = NO_COUNTS, collapsed = false, onNavigate, own = {}, foldable = true }: { groups: readonly MenuGroup[]; tenantId: string; activeItemId: string | null; labels?: Labels; waiting?: number | null; counts?: NavCounts; collapsed?: boolean; onNavigate?: () => void; /** The business type's own words (`ownWords`). */ own?: Readonly<Record<string, string>>; foldable?: boolean }) {
  // the folded groups of this browser (the first, server render: none)
  const text = useSyncExternalStore(subscribeFold, foldSnapshot, () => "[]");
  const folded = foldable ? (readFoldedHere() ?? parseFolded(text)) : [];
  const toggle = (id: string) => storeFolded(folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id]);
  const say = (key: string, fallback: string, vars: Record<string, string | number>) => word(labels, key, fallback, vars);
  return (
    <div className="space-y-2">
      {groups.map((g, gi) => {
        const heading = word(labels, `nav.group.${g.id}`, g.label);
        const holdsCurrent = g.items.some((i) => i.id === activeItemId);
        const isFolded = foldable && !collapsed && folded.includes(g.id) && !holdsCurrent;
        return (
          <div key={g.id} role="group" aria-label={heading} data-nav-group={g.id}>
            {collapsed ? (
              gi > 0 ? <hr className="mx-3 my-1 border-line" /> : null
            ) : foldable ? (
              <button type="button" onClick={() => toggle(g.id)} aria-expanded={!isFolded} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">
                <span className="min-w-0 text-left [overflow-wrap:anywhere]">{heading}</span>
                <SpriteIcon id="chevron-down" className={`size-4 shrink-0 transition-transform duration-150 ${isFolded ? "-rotate-90" : ""}`} />
              </button>
            ) : (
              <p aria-hidden="true" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {heading}
              </p>
            )}
            {isFolded ? null : (
              <div className="space-y-0.5">
                {g.items.map((i) => (
                  <NavLink key={i.id} item={i} tenantId={tenantId} on={activeItemId === i.id} labels={labels} badge={badgeOf(i.count, counts, waiting, say)} collapsed={collapsed} onNavigate={onNavigate} own={own} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
