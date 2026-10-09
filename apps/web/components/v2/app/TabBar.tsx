"use client";

import { Ellipsis, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { NavIcon } from "./icons";
import { NavGroups } from "./NavGroups";
import { word, type Labels } from "./labels";
import { barItems, hrefOf, visibleGroups } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted";
const tabOn = "text-brand-text font-semibold";

/**
 * The bottom bar on a phone (under 768px): the daily pages (Today, Follow-ups, Leads, Orders: each only when the role may open it) and "More", which opens
 * the whole menu, the same groups as the side menu, in a full-screen list. Respects the phone's safe area.
 */
export function TabBar({ memberships, labels }: { memberships: readonly Membership[]; labels?: Labels }) {
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
  const tabs = barItems(current.role);
  const inRest = active ? !tabs.some((i) => i.id === active.item.id) : false;
  return (
    <>
      <nav aria-label={word(labels, "frame.menu.quick", "Quick menu")} className="flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {tabs.map((i) => {
          const on = active?.item.id === i.id;
          const text = word(labels, `nav.tab.${i.id}`, i.bar ?? i.label);
          return (
            <Link key={i.id} href={hrefOf(i, current.id)} aria-current={on ? "page" : undefined} className={`${tab} ${on ? tabOn : ""}`}>
              <NavIcon name={i.barIcon ?? "today"} />
              <span className={`text-center ${/\s/.test(text) ? "" : "whitespace-nowrap"}`}>{text}</span>
            </Link>
          );
        })}
        <button ref={moreRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`${tab} ${inRest ? tabOn : ""}`}>
          <Ellipsis className="size-5" aria-hidden="true" />
          <span>{word(labels, "frame.more", "More")}</span>
        </button>
      </nav>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={word(labels, "frame.menu.all", "All of the menu")} className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg">
          <div className="flex min-h-16 items-center justify-between border-b border-line px-4">
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-bold">{current.name}</p>
              <p className="text-sm text-muted">{word(labels, "frame.role", "Your role here: {role}", { role: current.role })}</p>
            </div>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface" aria-label={word(labels, "frame.close", "Close the menu")}>
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="px-3 py-5 pb-24">
            <NavGroups groups={groups} tenantId={current.id} activeItemId={active?.item.id ?? null} activeGroupId={active?.group.id ?? null} pathname={pathname} labels={labels} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
