"use client";

import { CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu } from "./AccountMenu";
import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { frameBand } from "./frame-style";
import { LiveNow } from "./live/LiveNow";
import { itemBase, itemCurrent, itemIdle, NavGroups, NavLink } from "./NavGroups";
import { word, withPackWords, type Labels } from "./labels";
import { menuFoot, menuGroups } from "./nav";
import { useCollapsed } from "./use-collapsed";
import { useWorkspace, type Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export { itemCurrent };

/**
 * The menu beside the page on a tablet or desktop (768px and up), as the design-lab app draws it: the business and its plan on top; the groups of the menu table
 * (nav.ts), each row only for the roles that may open it; and, fixed below, the AI usage card, Settings, Help ("Not available yet"), the user card and "Collapse menu".
 * Outside a workspace (the workspaces page, the security page) the groups give way to the two account pages.
 */
export function SideNav({ memberships, labels: given_labels, frame: given, email, signOut, mark }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData; email: string | null; signOut: () => Promise<void>; mark: ReactNode }) {
  const { current, pathname, activeMenu } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const labels = withPackWords(given_labels, frame.pack);
  const [collapsed, toggle] = useCollapsed();
  const aria = word(labels, "frame.menu.workspace", "Workspace menu");
  const help = word(labels, "frame.help", "Help");
  const foot = current ? menuFoot(current.role, frame.pack) : [];
  const badge = frame.pack && !frame.pack.validated ? frame.pack : null;
  return (
    <aside className={`${frameBand} ${collapsed ? "w-[72px]" : "w-[232px]"} print:hidden`}>
      <WorkspaceSwitcher memberships={memberships} labels={labels} plan={frame.plan} loading={!frame.ready} collapsed={collapsed} pack={badge} />
      <nav aria-label={aria} className="min-h-0 flex-1 overflow-y-auto p-2">
        {current ? (
          <NavGroups groups={menuGroups(current.role, frame.pack)} tenantId={current.id} activeItemId={activeMenu} labels={labels} waiting={frame.waiting} collapsed={collapsed} />
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
        {!current || !frame.live ? null : <LiveNow memberships={memberships} labels={labels} enabled={frame.live} variant="side" collapsed={collapsed} />}
        {current ? foot.map((i) => <NavLink key={i.id} item={i} tenantId={current.id} on={activeMenu === i.id} labels={labels} collapsed={collapsed} />) : null}
        {current ? (
          <Link href={`/app/tenants/${current.id}/help`} aria-current={pathname.startsWith(`/app/tenants/${current.id}/help`) ? "page" : undefined} title={collapsed ? help : undefined} className={`${itemBase} w-full ${pathname.startsWith(`/app/tenants/${current.id}/help`) ? itemCurrent : itemIdle} ${collapsed ? "justify-center px-0" : ""}`}>
            <CircleHelp className="size-5 shrink-0" aria-hidden="true" />
            {collapsed ? <span className="sr-only">{help}</span> : <span className="min-w-0 flex-1 truncate text-left">{help}</span>}
          </Link>
        ) : (
          <button type="button" aria-disabled="true" title={collapsed ? `${help}: ${word(labels, "frame.notyet", "Not available yet")}` : undefined} className={`${itemBase} w-full text-muted ${collapsed ? "justify-center px-0" : ""}`}>
            <CircleHelp className="size-5 shrink-0" aria-hidden="true" />
            {collapsed ? <span className="sr-only">{help}</span> : <span className="min-w-0 flex-1 truncate text-left text-ink">{help}</span>}
            {collapsed ? null : <span className="text-sm font-normal">{word(labels, "frame.notyet", "Not available yet")}</span>}
          </button>
        )}
        <AccountMenu email={email} role={current?.role ?? null} signOut={signOut} labels={labels} collapsed={collapsed} several={memberships.length > 1} mark={mark} />
        <button type="button" onClick={toggle} aria-label={collapsed ? word(labels, "frame.expand", "Expand menu") : word(labels, "frame.collapse", "Collapse menu")} className={`${itemBase} w-full ${itemIdle} ${collapsed ? "justify-center px-0" : ""}`}>
          {collapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
          {collapsed ? null : <span>{word(labels, "frame.collapse", "Collapse menu")}</span>}
        </button>
      </div>
    </aside>
  );
}
