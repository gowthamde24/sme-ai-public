"use client";

import { IntentLink as Link } from "./NavGroups";
import { useEffect, useRef, type ReactNode } from "react";


import { AccountMenu } from "./AccountMenu";
import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { frameBand } from "./frame-style";
import { SpriteIcon } from "./icons";
import { itemBase, itemCurrent, itemIdle, NavGroups, ownWords } from "./NavGroups";
import { NavMeters } from "./LazyNavMeters";
import { word, withPackWords, type Labels } from "./labels";
import { ADMINS, activeV4dId, menuGroups, menuGroupsV4, menuGroupsV4D } from "./nav";
import { OPEN_PALETTE } from "./palette/open-event";
import { useNavCounts } from "./use-nav-counts";
import { BrandMark, PoweredBy } from "./frame-parts";
import { BRAND_NAME } from "@/design/brand";
import { useCollapsed } from "./use-collapsed";
import { useWorkspace, type Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export { itemCurrent };

/**
 * The menu beside the page on a tablet or desktop (768px and up), sidebar v2 (owner-approved design, 5 Nov 2026): the business, its plan and its type on top; the five groups of the menu table (nav.ts), each row only for the
 * roles and the business type that have it, with its live count (C1's nav-counts, asked after the page is drawn); and, fixed below, the two meters (call minutes, AI usage: Owner and Admin), "Top up · Plan & usage · Help", the
 * person and "Collapse menu". Outside a workspace the groups give way to the two account pages.
 */
export function SideNav({ memberships, labels: given_labels, frame: given, email, signOut, mark, still = false }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData; email: string | null; signOut: () => Promise<void>; mark: ReactNode; /** The demo video (job demo-video): no plan line under the business name. */ still?: boolean }) {
  const { current, pathname, activeMenu, activeV4 } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const labels = withPackWords(given_labels, frame.pack);
  const [collapsed, toggle] = useCollapsed();
  const aria = word(labels, "frame.menu.workspace", "Workspace menu");
  const counts = useNavCounts(current?.id ?? null);
  // the current row in view (a page of AI team or Setup on a short window)
  const navRef = useRef<HTMLElement>(null);
  // again once the business type's menu has arrived (its rows are drawn then: on a first paint the current row may not exist yet)
  useEffect(() => {
    // (app v4 draws the menu twice, one for each width: the one that is shown is the one with a box)
    if (navRef.current && navRef.current.scrollHeight <= navRef.current.clientHeight + 1) return; // (a menu that is not scrolled on its own, a short window, shows all its rows: nothing to bring into view, and the header must not move)
    const rows = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[aria-current="page"]') ?? []);
    (rows.find((r) => r.offsetParent !== null) ?? rows[0])?.scrollIntoView?.({ block: "nearest" });
  }, [activeMenu, activeV4, frame.ready, frame.pack]);
  // app v4 on a desktop (1024 px and up): the design's menu (owner, 7 Nov 2026)
  const desktop = current && frame.v4 ? menuGroupsV4D(current.role, frame.pack) : null;
  const badge = frame.pack && !frame.pack.validated ? frame.pack : null;
  return (
    <aside className={`${frameBand} ${collapsed ? "w-[72px]" : "w-[256px]"} ${frame.v4 ? "nv-short" : ""} print:hidden`}>
      {desktop ? (
        <Link href={`/app/tenants/${current?.id}`} data-part="menu-logo" aria-label={BRAND_NAME} title={collapsed ? BRAND_NAME : undefined} className={`hidden min-h-10 items-center gap-2.5 px-4 pt-2 lg:flex ${collapsed ? "justify-center px-0" : ""}`}>
          <BrandMark px={28} />
          {collapsed ? null : <span className="font-display text-xl font-extrabold tracking-tight">{BRAND_NAME}</span>}
        </Link>
      ) : null}
      <WorkspaceSwitcher memberships={memberships} labels={labels} plan={frame.plan} loading={!frame.ready} collapsed={collapsed} pack={badge} logoUrl={frame.logoUrl} still={still} />
      {desktop ? (
        <div className="hidden px-2 pb-0.5 pt-1.5 lg:block">
          <button type="button" data-top="menu-search" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))} aria-haspopup="dialog" aria-label={word(labels, "frame.search.jump", "Search or jump to")} title={collapsed ? word(labels, "frame.search.jump", "Search or jump to") : undefined} className={`inline-flex min-h-11 w-full items-center gap-2 rounded-xl border border-edge bg-surface px-3 text-left text-sm text-muted hover:border-brand-edge ${collapsed ? "justify-center px-0" : ""}`}>
            <SpriteIcon id="search" className="size-5 shrink-0" />
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate">{word(labels, "frame.search.jump", "Search or jump to")}</span>
                <kbd className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 font-sans text-xs text-muted">⌘K</kbd>
              </>
            )}
          </button>
        </div>
      ) : null}
      {/* the rows scroll on their own above the fixed foot (owner's review, 5 Nov: AI team and Setup must never sit hidden under the meters): a soft shadow at an edge says there is more; the current row is scrolled into view */}
      <nav ref={navRef} aria-label={aria} data-nav-scroll="" className={`v2-scroll-hint min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 lg:py-1${frame.v4 ? " [@media(max-height:900px)]:flex-none [@media(max-height:900px)]:overflow-visible" : ""}`}>
        {current && desktop ? (
          <>
            {/* 768 to 1023 px: the five groups, as before */}
            <div className="lg:hidden">
              <NavGroups groups={menuGroupsV4(current.role, frame.pack)} tenantId={current.id} activeItemId={activeV4} labels={labels} waiting={frame.waiting} counts={counts} collapsed={collapsed} own={ownWords(frame.pack, given_labels)} />
            </div>
            {/* 1024 px and up: the design's groups, each with its live chip */}
            <div className="hidden lg:block [&_[data-nav-row]]:min-h-10 [@media(max-height:900px)]:[&_[data-nav-row]]:min-h-9" data-part="menu-desktop">
              <NavGroups design groups={desktop} tenantId={current.id} activeItemId={activeV4dId(desktop, activeMenu)} labels={labels} waiting={frame.waiting} counts={counts} collapsed={collapsed} own={ownWords(frame.pack, given_labels)} />
            </div>
          </>
        ) : current ? (
          <NavGroups groups={menuGroups(current.role, frame.pack)} tenantId={current.id} activeItemId={activeMenu} labels={labels} waiting={frame.waiting} counts={counts} collapsed={collapsed} own={ownWords(frame.pack, given_labels)} />
        ) : (
          <div className="space-y-1">
            {[
              { href: "/app", label: word(labels, "frame.all", "All workspaces"), on: pathname === "/app" },
              { href: "/app/security", label: word(labels, "frame.security", "Security"), on: pathname.startsWith("/app/security") },
            ].map((p) => (
              <Link key={p.href} href={p.href} aria-current={p.on ? "page" : undefined} className={`${itemBase} ${p.on ? itemCurrent : itemIdle}`}>
                {p.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
      <div className="space-y-1.5 border-t border-line p-2">
        {current && collapsed ? (
          <Link href={`/app/tenants/${current.id}/help`} title={word(labels, "frame.help", "Help")} className={`${itemBase} w-full justify-center px-0 ${pathname.startsWith(`/app/tenants/${current.id}/help`) ? itemCurrent : itemIdle}`}>
            <SpriteIcon id="circle-help" className="size-5 shrink-0" />
            <span className="sr-only">{word(labels, "frame.help", "Help")}</span>
          </Link>
        ) : null}
        {current && !collapsed ? <NavMeters counts={counts} tenantId={current.id} labels={labels} manages={(ADMINS as readonly string[]).includes(current.role)} /> : null}
        <AccountMenu email={email} role={current?.role ?? null} signOut={signOut} labels={labels} collapsed={collapsed} several={memberships.length > 1} mark={mark} />
        {/* the foot is short, so the rows above get the room: "Powered by" and the collapse button share one line */}
        <div className={`flex items-center gap-1 ${collapsed ? "flex-col" : "justify-between"}`}>
          <PoweredBy labels={labels} compact={collapsed} />
          <button type="button" onClick={toggle} aria-label={collapsed ? word(labels, "frame.expand", "Expand menu") : word(labels, "frame.collapse", "Collapse menu")} title={collapsed ? word(labels, "frame.expand", "Expand menu") : word(labels, "frame.collapse", "Collapse menu")} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg ${itemIdle}`}>
            {collapsed ? <SpriteIcon id="panel-left-open" /> : <SpriteIcon id="panel-left-close" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
