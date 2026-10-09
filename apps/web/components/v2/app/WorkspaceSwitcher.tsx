"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { BRAND_NAME } from "@/design/brand";

import type { Plan } from "./contract";
import { Disclosure } from "./Disclosure";
import { BrandMark, NotYetText, planText } from "./frame-parts";
import { word, type Labels } from "./labels";
import { useWorkspace, type Membership } from "./use-workspace";

const rowLink = "flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-base text-ink hover:bg-surface-2";

/**
 * The top of the side menu: the orange mark, the business name and its plan. One subscriber is one business, so there is no list of workspaces and no switcher:
 * only a person who belongs to two or more gets the name as a button that opens the list (and the page of all workspaces). Outside a workspace it names the product.
 * `plan` null says "Not available yet" under the name (`loading`: it is still being read, so the line stays empty).
 */
export function WorkspaceSwitcher({ memberships, labels, plan, loading = false, collapsed = false }: { memberships: readonly Membership[]; labels?: Labels; plan: Plan | null; loading?: boolean; collapsed?: boolean }) {
  const { current } = useWorkspace(memberships);
  const name = current?.name ?? BRAND_NAME;
  const body = collapsed ? (
    <BrandMark />
  ) : (
    <>
      <BrandMark />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-display text-base font-semibold leading-tight">{name}</span>
        {current ? <span className="block truncate text-sm text-muted">{planText(plan, labels) ?? (loading ? "\u00a0" : <NotYetText labels={labels} className="" />)}</span> : null}
      </span>
    </>
  );
  const frame = `flex min-h-16 w-full items-center gap-3 border-b border-line p-4 ${collapsed ? "justify-center px-0" : ""}`;
  if (memberships.length < 2 || collapsed) {
    return (
      <Link href={current ? `/app/tenants/${current.id}` : "/app"} className={frame} aria-label={collapsed ? name : undefined} title={collapsed ? name : undefined}>
        {body}
      </Link>
    );
  }
  return (
    <Disclosure
      summaryClassName={`${frame} hover:bg-surface-2`}
      panelClassName="absolute inset-x-2 top-full z-50 mt-1 max-h-[70dvh] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]"
      summary={
        <>
          {body}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">{word(labels, "frame.switch", "Switch workspace")}</span>
        </>
      }
    >
      <ul aria-label={word(labels, "frame.yourworkspaces", "Your workspaces")}>
        {memberships.map((m) => (
          <li key={m.id}>
            <Link href={`/app/tenants/${m.id}`} className={rowLink} aria-current={current?.id === m.id ? "true" : undefined}>
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="text-sm capitalize text-muted">{m.role}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line pt-1">
        <Link href="/app" className={rowLink}>
          {word(labels, "frame.all", "All workspaces")}
        </Link>
      </div>
    </Disclosure>
  );
}
