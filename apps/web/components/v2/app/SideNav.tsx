"use client";

import Link from "next/link";

import { NavIcon } from "./icons";
import { hrefOf, visibleGroups } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

export const itemClass = "flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-ink hover:bg-surface-2";
export const itemCurrent = "bg-brand-bg text-brand-text font-semibold";

/** The menu beside the page on a tablet or desktop (768px and up): the groups of the plan's table, each item only for the roles that may open it. */
export function SideNav({ memberships }: { memberships: readonly Membership[] }) {
  const { current, active } = useWorkspace(memberships);
  if (!current) return null;
  const groups = visibleGroups(current.role);
  return (
    <nav aria-label="Workspace menu" className="flex flex-col gap-5 px-3 py-5">
      {groups.map((g) => (
        <div key={g.id}>
          {g.items.length > 1 || g.id !== "today" ? (
            <p className="mb-1 flex items-center gap-2 px-3 text-sm font-semibold uppercase tracking-wide text-muted">
              <NavIcon name={g.icon} className="size-4" />
              {g.label}
            </p>
          ) : null}
          <ul>
            {g.items.map((i) => {
              const isCurrent = active?.item.id === i.id;
              return (
                <li key={i.id}>
                  <Link href={hrefOf(i, current.id)} aria-current={isCurrent ? "page" : undefined} className={`${itemClass} ${isCurrent ? itemCurrent : ""}`}>
                    {g.id === "today" ? <NavIcon name="today" className="size-5" /> : null}
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
