"use client";

import { IntentLink as Link } from "./NavGroups";
import { useCallback, useRef, useState, type ReactNode } from "react";

import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { NavIcon, SpriteIcon } from "./icons";
import { MoreSheet } from "./LazyMoreSheet";
import { ownWords, rowWord } from "./NavGroups";
import { word, withPackWords, type Labels } from "./labels";
import { barNumber } from "./nav-badges";
import { activeV6Id, hrefOf, menuBar, menuGroupsV4, menuGroups, menuGroupsV6 } from "./nav";
import { useNavCounts } from "./use-nav-counts";
import { useWorkspace, type Membership } from "./use-workspace";

const cell = "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 pb-1 pt-1.5 text-center text-sm font-medium leading-tight transition-colors duration-150 ease-out active:bg-surface-2";
/** The phone's bar in design system v6, in this order. */
const V6_BAR = ["v6-today", "v6-calls", "v6-chats", "v6-leads"];
const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

/**
 * The bottom bar on a phone (under 768px), sidebar v2 (owner-approved design, 5 Nov 2026): Today, Leads, Chats and Calls with their icons, words and round count badges (C1's nav-counts; each only when the role and the business
 * type have it) and "More", a sheet from the bottom with every other row of the menu in its groups (Sell extras, Business, AI team, Setup), the two meters and "Top up · Plan & usage · Help", the person, the workspaces and Sign out.
 * The bar and the sheet are frosted glass (solid where the browser cannot blur or the person asked for less transparency). Respects the phone's safe area. Outside a workspace the bar is not drawn.
 */
export function TabBar({ memberships, labels: given_labels, frame: given, email, signOut, mark: accountMark }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData; email: string | null; signOut: () => Promise<void>; /** The round mark, drawn by the server (the person's picture over their letters, or the letters of the e-mail address). */ mark: ReactNode }) {
  const { current, pathname, tab, activeMenu, activeV4 } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const labels = withPackWords(given_labels, frame.pack);
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  // a new page closes the sheet (state adjusted while rendering, not in an effect)
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }
  // closing gives the focus back to More
  const close = useCallback(() => {
    setOpen(false);
    moreRef.current?.focus();
  }, []);
  const counts = useNavCounts(current?.id ?? null);
  if (!current) return null;
  // app v4: the bar is the five groups and there is no "More" (⌘K reaches every page; the person and Sign out are in the top bar)
  // design system v6 (owner, 13 Nov 2026): the bar is Today, Calls, Chats, Leads and More (My assistant, Campaigns, Reports, Catalogue, Phone numbers, Billing); never AI team, Sales or Customers
  const v6 = frame.ds === true ? menuGroupsV6(current.role, frame.pack) : null;
  const v6Items = v6?.flatMap((g) => g.items) ?? [];
  const v4 = frame.v4 === true && !v6;
  const tabs = v6 ? V6_BAR.map((id) => v6Items.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => i !== undefined) : v4 ? (menuGroupsV4(current.role, frame.pack)[0]?.items ?? []) : menuBar(current.role, frame.pack);
  const activeId = v6 ? activeV6Id(v6, pathname, tab) : v4 ? activeV4 : activeMenu;
  // the More sheet: every other row, in its groups (Overview's "Talk to assistant" too: the orb is on every page, but a word helps)
  const rest = (v6 ?? (v4 ? [] : menuGroups(current.role, frame.pack)))
    .map((g) => ({ ...g, items: g.items.filter((i) => !tabs.some((t) => t.id === i.id)) }))
    .filter((g) => g.items.length > 0);
  const moreOn = activeId ? rest.some((g) => g.items.some((i) => i.id === activeId)) : false;
  const mark = <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand-edge" />;
  const own = ownWords(frame.pack, given_labels);
  return (
    <>
      <nav aria-label={word(labels, "frame.menu.quick", "Quick menu")} className={`v2-glass grid border-t border-line pb-[env(safe-area-inset-bottom)] ${COLS[tabs.length + (v4 ? 0 : 1)] ?? "grid-cols-6"}`}>
        {tabs.map((i) => {
          const on = activeId === i.id;
          const n = barNumber(i.count, counts, frame.waiting);
          const text = word(labels, `nav.tab.${i.id}`, rowWord(i, labels, own));
          return (
            <Link key={i.id} href={hrefOf(i, current.id)} aria-current={on ? "page" : undefined} data-bar-tab={i.id} className={`${cell} ${on ? "text-brand-text" : "text-muted"}`}>
              {on ? mark : null}
              <span className="relative">
                <NavIcon name={i.icon} className="size-6" />
                {v4 && (i.id === "calls" || i.id === "v4-customers") && (counts.liveCalls ?? 0) > 0 ? (
                  <span data-bar-live={i.id} className="absolute -left-1 -top-1">
                    <span aria-hidden="true" className="lv-dot block" />
                    <span className="sr-only">{word(labels, "frame.live.aria", "Live call")}</span>
                  </span>
                ) : null}
                {n !== null ? (
                  <span data-bar-badge={i.id} className="absolute -right-2.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-xs font-semibold leading-5 text-on-brand">
                    <span className="sr-only">{text}: </span>
                    {n > 99 ? "99+" : n}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full break-words tracking-tighter">{text}</span>
            </Link>
          );
        })}
        {v4 ? null : (
          <button ref={moreRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} data-bar-tab="more" className={`${cell} ${moreOn ? "text-brand-text" : "text-muted"}`}>
            {moreOn ? mark : null}
            <SpriteIcon id="menu" className="size-6" />
            <span>{word(labels, "frame.more", "More")}</span>
          </button>
        )}
      </nav>
      {open && !v4 ? (
        <MoreSheet current={current} memberships={memberships} email={email} signOut={signOut} accountMark={accountMark} labels={labels} rest={rest} activeMenu={activeMenu} waiting={frame.waiting} counts={counts} own={own} onClose={close} balanceBox={v6 ? { balance: frame.balance ?? null } : null} />
      ) : null}
    </>
  );
}
