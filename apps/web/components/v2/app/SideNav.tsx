"use client";

import Link from "next/link";

import { NavGroups, itemClass, itemCurrent } from "./NavGroups";
import { word, type Labels } from "./labels";
import { visibleGroups } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

export { itemClass, itemCurrent };

/**
 * The menu beside the page on a tablet or desktop (768px and up): the groups of the menu table (nav.ts), each item only for the roles that may open it.
 * Outside a workspace (the workspaces page, the security page) it offers the two account pages instead.
 */
export function SideNav({ memberships, labels }: { memberships: readonly Membership[]; labels?: Labels }) {
  const { current, pathname, active } = useWorkspace(memberships);
  const aria = word(labels, "frame.menu.workspace", "Workspace menu");
  if (!current) {
    const pages = [
      { href: "/app", label: word(labels, "frame.all", "All workspaces"), on: pathname === "/app" },
      { href: "/app/security", label: word(labels, "frame.security", "Security"), on: pathname.startsWith("/app/security") },
    ];
    return (
      <nav aria-label={aria} className="px-3 py-4">
        <ul>
          {pages.map((p) => (
            <li key={p.href}>
              <Link href={p.href} aria-current={p.on ? "page" : undefined} className={`${itemClass} ${p.on ? itemCurrent : ""}`}>
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label={aria} className="px-3 py-4">
      <NavGroups groups={visibleGroups(current.role)} tenantId={current.id} activeItemId={active?.item.id ?? null} activeGroupId={active?.group.id ?? null} pathname={pathname} labels={labels} />
    </nav>
  );
}
