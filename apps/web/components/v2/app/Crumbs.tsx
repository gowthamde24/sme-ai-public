"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { word, type Labels } from "./labels";
import { hrefOf, workspaceOf } from "./nav";
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * The way back. The design-lab app has no breadcrumb line, so on a page below a menu item there is one arrow back to that item ("← Leads"), at every width;
 * on a page that is the menu item itself it draws nothing (and nothing outside a workspace). The page's own heading names the lead, the company or the order.
 */
export function Crumbs({ memberships, labels }: { memberships: readonly Membership[]; labels?: Labels }) {
  const { current, pathname, active } = useWorkspace(memberships);
  if (!current || !active) return null;
  const ws = workspaceOf(pathname);
  const isTop = ws?.rest === active.item.path;
  if (isTop) return null;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-3 md:px-8">
      <Link href={hrefOf(active.item, current.id)} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-base font-semibold text-brand-text hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {word(labels, `nav.item.${active.item.id}`, active.item.label)}
      </Link>
    </div>
  );
}
