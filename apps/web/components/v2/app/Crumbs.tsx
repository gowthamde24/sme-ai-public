"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { hrefOf, workspaceOf } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * Where you are. Desktop: "Workspace › Group › Page" (static parents only; the page's own heading names the lead, company or order).
 * Phone: on a page below a menu item, one arrow back to that item ("← Orders"). Draws nothing on a top-level page or outside a workspace.
 */
export function Crumbs({ memberships }: { memberships: readonly Membership[] }) {
  const { current, pathname, active } = useWorkspace(memberships);
  if (!current || !active) return null;
  const ws = workspaceOf(pathname);
  const itemHref = hrefOf(active.item, current.id);
  const isTop = ws?.rest === active.item.path || (active.item.id === "today" && ws?.rest === "");
  const deeper = !isTop && !pathname.startsWith("/app/security");
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 px-4 pt-2 text-sm text-muted">
      {deeper ? (
        <Link href={itemHref} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-text md:hidden">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {active.item.label}
        </Link>
      ) : null}
      <ol className="hidden items-center gap-1 md:flex" aria-label="You are here">
        <li>
          <Link href={`/app/tenants/${current.id}`} className="hover:underline">
            {current.name}
          </Link>
        </li>
        {active.group.id !== "today" ? (
          <>
            <li aria-hidden="true">
              <ChevronRight className="size-4" />
            </li>
            <li>{active.group.label}</li>
          </>
        ) : null}
        {active.item.id !== "today" ? (
          <>
            <li aria-hidden="true">
              <ChevronRight className="size-4" />
            </li>
            <li>{deeper ? <Link href={itemHref} className="hover:underline">{active.item.label}</Link> : <span aria-current="page">{active.item.label}</span>}</li>
          </>
        ) : null}
      </ol>
    </div>
  );
}
