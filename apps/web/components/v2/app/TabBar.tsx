"use client";

import { Ellipsis, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { NavIcon } from "./icons";
import { TAB_GROUPS, groupHref, hrefOf, visibleGroups } from "./nav";
import { itemClass, itemCurrent } from "./SideNav";
import { useWorkspace, type Membership } from "./use-workspace";

const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted";
const tabOn = "text-brand-text font-semibold";

/**
 * The bottom bar on a phone (under 768px): Today, Customers, Quotes and orders, Follow-ups (each only when the role is offered something in it)
 * and "More", which opens every other group in a full-screen list. Respects the phone's safe area.
 */
export function TabBar({ memberships }: { memberships: readonly Membership[] }) {
  const { current, pathname, active } = useWorkspace(memberships);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // a new page closes the list (state adjusted while rendering, not in an effect)
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!current) return null;
  const groups = visibleGroups(current.role);
  const tabs = groups.filter((g) => (TAB_GROUPS as readonly string[]).includes(g.id));
  const rest = groups.filter((g) => !(TAB_GROUPS as readonly string[]).includes(g.id));
  const inRest = active ? rest.some((g) => g.id === active.group.id) : false;
  return (
    <>
      <nav aria-label="Quick menu" className="flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {tabs.map((g) => {
          const on = active?.group.id === g.id;
          return (
            <Link key={g.id} href={groupHref(g, current.id)} aria-current={on ? "page" : undefined} className={`${tab} ${on ? tabOn : ""}`}>
              <NavIcon name={g.icon} />
              <span className={`text-center leading-tight ${/\s/.test(g.label) ? "" : "whitespace-nowrap"}`}>{g.label}</span>
            </Link>
          );
        })}
        <button ref={moreRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`${tab} ${inRest ? tabOn : ""}`}>
          <Ellipsis className="size-5" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="All of the menu" className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg">
          <div className="flex min-h-16 items-center justify-between border-b border-line px-4">
            <p className="font-display text-xl font-bold">{current.name}</p>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface" aria-label="Close the menu">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col gap-5 px-3 py-5 pb-24">
            {groups.map((g) => (
              <div key={g.id}>
                <p className="mb-1 flex items-center gap-2 px-3 text-sm font-semibold uppercase tracking-wide text-muted">
                  <NavIcon name={g.icon} className="size-4" />
                  {g.label}
                </p>
                <ul>
                  {g.items.map((i) => {
                    const on = active?.item.id === i.id;
                    return (
                      <li key={i.id}>
                        <Link href={hrefOf(i, current.id)} aria-current={on ? "page" : undefined} className={`${itemClass} ${on ? itemCurrent : ""}`}>
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
