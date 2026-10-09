"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useSyncExternalStore } from "react";

import { NavIcon } from "./icons";
import { word, type Labels } from "./labels";
import { hrefOf, type VisibleGroup } from "./nav";

export const itemClass = "flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-ink hover:bg-surface-2";
export const itemCurrent = "bg-brand-bg text-brand-text font-semibold";
const headClass = "flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-semibold text-ink";
const STORE = "sme_nav_open";

/**
 * What the person opened or closed last time (a convenience only: with no storage, or a broken value, the menu works and starts as the table says).
 * Read as an external store, so the first (server) render is the table's own default and the browser's value arrives after hydration.
 */
const listeners = new Set<() => void>();
function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}
function snapshot(): string {
  try {
    return window.localStorage.getItem(STORE) ?? "{}";
  } catch {
    return "{}";
  }
}
function parse(raw: string): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function remember(id: string, open: boolean) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify({ ...parse(snapshot()), [id]: open }));
  } catch {
    /* no storage: the choice lasts until the page changes */
  }
  listeners.forEach((l) => l());
}

/**
 * The groups of the menu, one drawing for the side menu and the phone's "More" list so the two cannot drift (both read `visibleGroups`).
 * A group with one item for the role is a plain link; a group that opens and closes is a native <details> (it works without script: a closed group can still
 * be opened); the other groups show their heading and their items. The group that holds the current page opens itself when the page changes; what the
 * person opens or closes is remembered in this browser (try/catch: the page works without storage).
 */
export function NavGroups({ groups, tenantId, activeItemId, activeGroupId, pathname, labels, onNavigate }: { groups: readonly VisibleGroup[]; tenantId: string; activeItemId: string | null; activeGroupId: string | null; pathname: string; labels?: Labels; onNavigate?: () => void }) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  const stored = useMemo(() => parse(raw), [raw]);
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname); // a new page: forget this page's own open or close (state adjusted while rendering)
    setChoice({});
  }
  const prefix = useId();
  const openOf = (g: VisibleGroup) => choice[g.id] ?? (g.id === activeGroupId ? true : (stored[g.id] ?? g.defaultOpen));
  const link = (g: VisibleGroup, i: VisibleGroup["items"][number], icon: boolean) => {
    const on = activeItemId === i.id;
    return (
      <Link href={hrefOf(i, tenantId)} aria-current={on ? "page" : undefined} onClick={onNavigate} className={`${itemClass} ${on ? itemCurrent : ""}`}>
        {icon ? <NavIcon name={g.icon} className="size-5" /> : null}
        <span className="min-w-0">{word(labels, `nav.item.${i.id}`, i.label)}</span>
      </Link>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const name = word(labels, `nav.group.${g.id}`, g.label);
        if (g.flat) return <div key={g.id}>{link(g, g.items[0], true)}</div>;
        if (g.collapsible)
          return (
            <details
              key={g.id}
              open={openOf(g)}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open;
                if (isOpen === openOf(g)) return;
                setChoice((c) => ({ ...c, [g.id]: isOpen }));
                remember(g.id, isOpen);
              }}
              className="group"
            >
              <summary className={`${headClass} cursor-pointer list-none hover:bg-surface-2 [&::-webkit-details-marker]:hidden`}>
                <NavIcon name={g.icon} className="size-5" />
                <span className="min-w-0 flex-1">{name}</span>
                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="ml-4 border-l border-line pl-2">
                {g.items.map((i) => (
                  <li key={i.id}>{link(g, i, false)}</li>
                ))}
              </ul>
            </details>
          );
        return (
          <div key={g.id} role="group" aria-labelledby={`${prefix}-${g.id}`}>
            <p id={`${prefix}-${g.id}`} className={`${headClass} min-h-8 text-sm uppercase tracking-wide text-muted`}>
              <NavIcon name={g.icon} className="size-4" />
              {name}
            </p>
            <ul className="ml-4 border-l border-line pl-2">
              {g.items.map((i) => (
                <li key={i.id}>{link(g, i, false)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
