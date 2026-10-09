"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { Disclosure } from "./Disclosure";
import { useWorkspace, type Membership } from "./use-workspace";

const rowLink = "flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-base text-ink hover:bg-surface-2";

/**
 * The workspace name in the top bar, with a switcher. Choosing a workspace goes to THAT workspace's home, never to the same sub-page, so no id
 * of one workspace is ever carried into another. A person with one workspace sees the name and no arrow. Outside a workspace it says "Workspaces".
 */
export function WorkspaceSwitcher({ memberships }: { memberships: readonly Membership[] }) {
  const { current } = useWorkspace(memberships);
  const name = current?.name ?? "Workspaces";
  const role = current ? <span className="hidden rounded-md sm:inline bg-brand-bg px-2 py-0.5 text-sm font-semibold text-brand-text">{current.role}</span> : null;
  if (memberships.length === 0)
    return (
      <Link href="/app" className="flex min-h-11 items-center truncate font-display text-lg font-bold">
        {name}
      </Link>
    );
  if (memberships.length <= 1 && current) {
    return (
      <p className="flex min-h-11 min-w-0 items-center gap-2">
        <span className="truncate font-display text-lg font-bold">{name}</span>
        {role}
      </p>
    );
  }
  return (
    <Disclosure
      summaryClassName="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 hover:bg-surface-2"
      panelClassName="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]"
      summary={
        <>
          <span className="truncate font-display text-lg font-bold">{name}</span>
          {role}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Switch workspace</span>
        </>
      }
    >
      <ul aria-label="Your workspaces">
        {memberships.map((m) => (
          <li key={m.id}>
            <Link href={`/app/tenants/${m.id}`} className={rowLink} aria-current={current?.id === m.id ? "true" : undefined}>
              <span className="truncate">{m.name}</span>
              <span className="text-sm text-muted">{m.role}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line pt-1">
        <Link href="/app" className={rowLink}>
          All workspaces
        </Link>
        <Link href="/app#create-workspace" className={rowLink}>
          Create a workspace
        </Link>
      </div>
    </Disclosure>
  );
}
