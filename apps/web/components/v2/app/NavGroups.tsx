import Link from "next/link";

import { NavIcon } from "./icons";
import { word, type Labels } from "./labels";
import { hrefOf, type NavItem, type VisibleGroup } from "./nav";

export const itemBase = "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out";
export const itemIdle = "text-ink hover:bg-surface-2 active:bg-line";
export const itemCurrent = "bg-brand-bg text-brand-text";

/** One menu row: icon, word, the orange mark when it is the current page, and (on Today) the count of what is waiting. `collapsed` = the narrow rail: icon only, the word stays for a screen reader. */
export function NavLink({ item, tenantId, on, labels, badge, collapsed = false, onNavigate }: { item: NavItem; tenantId: string; on: boolean; labels?: Labels; badge?: number | null; collapsed?: boolean; onNavigate?: () => void }) {
  const text = word(labels, `nav.item.${item.id}`, item.label);
  return (
    <Link href={hrefOf(item, tenantId)} aria-current={on ? "page" : undefined} title={collapsed ? text : undefined} onClick={onNavigate} className={`${itemBase} ${collapsed ? "justify-center px-0" : ""} ${on ? itemCurrent : itemIdle}`}>
      {on ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-edge" /> : null}
      <NavIcon name={item.icon} />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{text}</span>
      {badge && badge > 0 ? (
        <span className={`grid min-w-6 place-items-center rounded-full bg-charcoal px-1.5 text-sm font-semibold text-on-charcoal ${collapsed ? "absolute right-1 top-0.5 min-w-5 px-1" : ""}`}>
          <span className="sr-only">{word(labels, "frame.waiting", "Waiting for you")}: </span>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The groups of the menu (Work, Your business, Your team, Connect), one drawing for the side menu and the phone's More sheet: a small heading, then the rows.
 * Plain groups, nothing opens or closes: there are few rows, so everything is one look away (Hick's law).
 */
export function NavGroups({ groups, tenantId, activeItemId, labels, waiting = null, collapsed = false, onNavigate }: { groups: readonly VisibleGroup[]; tenantId: string; activeItemId: string | null; labels?: Labels; waiting?: number | null; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => (
        <div key={g.id} role="group" aria-label={word(labels, `nav.group.${g.id}`, g.label)} className="space-y-0">
          {collapsed ? gi > 0 ? <hr className="mx-3 border-line" /> : null : <p aria-hidden="true" className="px-3 pb-1 text-sm font-semibold text-muted">{word(labels, `nav.group.${g.id}`, g.label)}</p>}
          {g.items.map((i) => (
            <NavLink key={i.id} item={i} tenantId={tenantId} on={activeItemId === i.id} labels={labels} badge={i.id === "today" ? waiting : null} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </div>
  );
}
