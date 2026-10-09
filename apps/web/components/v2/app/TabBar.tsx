"use client";

import { CircleHelp, Ellipsis, LogOut, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { initials } from "./AccountMenu";
import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { UsageCard } from "./frame-parts";
import { NavIcon } from "./icons";
import { word, type Labels } from "./labels";
import { barItems, footItems, hrefOf, visibleGroups } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

const cell = "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 pb-1 pt-1.5 text-center text-sm font-medium leading-tight transition-colors duration-150 ease-out active:bg-surface-2";
const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };
const row = "flex min-h-12 w-full items-center gap-3 rounded-lg border border-line px-3 text-left text-base font-medium transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line";

/**
 * The bottom bar on a phone (under 768px), as the design-lab app draws it: the daily pages (Today with the count of what is waiting, Leads, Quotes, Orders, Office:
 * each only when the role may open it) and "More", which opens a sheet with the rest of the menu (Customers, Catalogue and prices, Integrations, Settings),
 * the person, the AI usage card, Help ("Not available yet") and Sign out. Respects the phone's safe area. Outside a workspace the bar is not drawn.
 */
export function TabBar({ memberships, labels, frame: given, email, signOut }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData; email: string | null; signOut: () => Promise<void> }) {
  const { current, pathname, active } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // a new page closes the sheet (state adjusted while rendering, not in an effect)
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
  const tabs = barItems(current.role);
  const rest = [...visibleGroups(current.role).flatMap((g) => g.items), ...footItems(current.role)].filter((i) => !tabs.some((t) => t.id === i.id));
  const moreOn = active ? rest.some((i) => i.id === active.item.id) : false;
  const mark = <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand-edge" />;
  const help = word(labels, "frame.help", "Help");
  return (
    <>
      <nav aria-label={word(labels, "frame.menu.quick", "Quick menu")} className={`grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] ${COLS[tabs.length + 1] ?? "grid-cols-6"}`}>
        {tabs.map((i) => {
          const on = active?.item.id === i.id;
          return (
            <Link key={i.id} href={hrefOf(i, current.id)} aria-current={on ? "page" : undefined} className={`${cell} ${on ? "text-brand-text" : "text-muted"}`}>
              {on ? mark : null}
              <span className="relative">
                <NavIcon name={i.icon} className="size-6" />
                {i.id === "today" && frame.waiting && frame.waiting > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-charcoal px-1 text-sm font-semibold leading-5 text-on-charcoal">
                    <span className="sr-only">{word(labels, "frame.waiting", "Waiting for you")}: </span>
                    {frame.waiting}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full break-words">{word(labels, `nav.item.${i.id}`, i.label)}</span>
            </Link>
          );
        })}
        <button ref={moreRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`${cell} ${moreOn ? "text-brand-text" : "text-muted"}`}>
          {moreOn ? mark : null}
          <Ellipsis className="size-6" aria-hidden="true" />
          <span>{word(labels, "frame.more", "More")}</span>
        </button>
      </nav>
      {open ? (
        <div className="fixed inset-0 z-50">
          <div aria-hidden="true" className="absolute inset-0 bg-charcoal/50" onClick={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label={word(labels, "frame.menu.all", "All of the menu")} className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-line bg-bg shadow-[var(--v2-shadow-pop)]">
            <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-bold">{word(labels, "frame.more", "More")}</p>
                <p className="truncate text-sm text-muted">{current.name}</p>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface" aria-label={word(labels, "frame.close", "Close the menu")}>
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-5 px-4 pb-8 pt-5">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-charcoal font-semibold text-on-charcoal">
                  {initials(email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{email ?? word(labels, "frame.account", "Your account")}</p>
                  <p className="text-sm capitalize text-muted">{current.role}</p>
                </div>
              </div>
              <div className="space-y-2">
                {rest.map((i) => (
                  <Link key={i.id} href={hrefOf(i, current.id)} aria-current={active?.item.id === i.id ? "page" : undefined} onClick={() => setOpen(false)} className={`${row} ${active?.item.id === i.id ? "border-brand-edge bg-brand-bg text-brand-text" : ""}`}>
                    <NavIcon name={i.icon} />
                    {word(labels, `nav.item.${i.id}`, i.label)}
                  </Link>
                ))}
                <button type="button" aria-disabled="true" className={`${row} text-muted`}>
                  <CircleHelp className="size-5" aria-hidden="true" />
                  <span className="flex-1 text-ink">{help}</span>
                  <span className="text-sm font-normal">{word(labels, "frame.notyet", "Not available yet")}</span>
                </button>
              </div>
              {frame.showUsage ? <UsageCard usage={frame.usage} loading={!frame.ready} labels={labels} /> : null}
              {memberships.length > 1 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{word(labels, "frame.yourworkspaces", "Your workspaces")}</p>
                  {memberships.map((m) => (
                    <Link key={m.id} href={`/app/tenants/${m.id}`} aria-current={m.id === current.id ? "true" : undefined} onClick={() => setOpen(false)} className={`${row} justify-between`}>
                      <span className="min-w-0 truncate">{m.name}</span>
                      <span className="text-sm font-normal capitalize text-muted">{m.role}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              <form action={signOut}>
                <button type="submit" className={`${row} text-red-text`}>
                  <LogOut className="size-5" aria-hidden="true" />
                  {word(labels, "frame.signout", "Sign out")}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
