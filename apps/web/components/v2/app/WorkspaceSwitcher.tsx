"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AddButton } from "./AddButton";
import { Disclosure } from "./Disclosure";
import { word, type Labels } from "./labels";
import { useWorkspace, type Membership } from "./use-workspace";

const rowLink = "flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-base text-ink hover:bg-surface-2";

/**
 * The workspace name with a switcher: the top of the side menu on a tablet or desktop (`side`), the left of the top bar on a phone. Choosing a workspace goes
 * to THAT workspace's home, never to the same sub-page, so no id of one workspace is ever carried into another. The pop-over lists the person's workspaces and,
 * after them, ONE row "Add a workspace" that opens the page's own create form (`addForm`, the form of /app, unchanged) in place. Outside a workspace it says "Workspaces".
 */
export function WorkspaceSwitcher({ memberships, labels, addForm, side = false }: { memberships: readonly Membership[]; labels?: Labels; addForm?: ReactNode; side?: boolean }) {
  const { current } = useWorkspace(memberships);
  const name = current?.name ?? word(labels, "frame.workspaces", "Workspaces");
  if (memberships.length === 0)
    return (
      <Link href="/app" className="flex min-h-11 items-center truncate font-display text-lg font-bold">
        {name}
      </Link>
    );
  return (
    <Disclosure
      summaryClassName={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 hover:bg-surface-2 ${side ? "w-full justify-between" : ""}`}
      panelClassName={`absolute top-full z-50 mt-1 max-h-[70dvh] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)] ${side ? "inset-x-0" : "left-0 w-72 max-w-[calc(100vw-2rem)]"}`}
      summary={
        <>
          <span className="min-w-0 text-left">
            <span className={`font-display font-bold leading-tight ${side ? "block truncate text-lg" : "line-clamp-2 text-base sm:block sm:truncate sm:text-lg"}`}>{name}</span>
            {current && side ? <span className="block text-sm text-muted">{current.role}</span> : null}
          </span>
          {current && !side ? <span className="hidden rounded-md bg-brand-bg px-2 py-0.5 text-sm font-semibold text-brand-text sm:inline">{current.role}</span> : null}
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
              <span className="text-sm text-muted">{m.role}</span>
            </Link>
          </li>
        ))}
      </ul>
      {addForm ? (
        <div className="mt-1 border-t border-line pt-1">
          <AddButton key={memberships.length} label={word(labels, "frame.addworkspace", "Add a workspace")} variant="menu">
            {addForm}
          </AddButton>
        </div>
      ) : null}
    </Disclosure>
  );
}
