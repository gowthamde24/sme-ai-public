"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Disclosure } from "./Disclosure";
import { word, type Labels } from "./labels";

const rowLink = "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-ink hover:bg-surface-2";

/**
 * The user card at the foot of the side menu: the person's mark, who is signed in and their role here; it opens upwards with Security, the page of all
 * workspaces (only for someone who belongs to two or more) and Sign out (the server action the workspaces page uses). `collapsed` = the narrow rail: the mark only.
 */
export function AccountMenu({ email, role, signOut, labels, collapsed = false, several = false, down = false, mark }: { email: string | null; role?: string | null; signOut: () => Promise<void>; labels?: Labels; collapsed?: boolean; several?: boolean; down?: boolean; /** The round mark, drawn by the server (the person's picture over their letters, or the letters of the e-mail address): a slot, so the picture and the letters cost this menu no script. */ mark: ReactNode; }) {
  const who = email ?? word(labels, "frame.account", "Your account");
  return (
    <Disclosure
      summaryClassName={down ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2" : `flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg border border-line px-2 text-ink hover:bg-surface-2 ${collapsed ? "justify-center border-transparent px-0" : ""}`}
      panelClassName={`absolute z-50 rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)] ${down ? "right-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)]" : `bottom-full mb-1 ${collapsed ? "left-0 w-60" : "inset-x-0"}`}`}
      summary={
        <>
          {mark}
          {collapsed || down ? null : (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold">{who}</span>
              {role ? <span className="block text-sm capitalize text-muted">{role}</span> : null}
            </span>
          )}
          <span className="sr-only">{word(labels, "frame.account", "Your account")}</span>
        </>
      }
    >
      <p className="truncate px-3 py-2 text-sm text-muted">{who}</p>
      <Link href="/app/security" className={rowLink}>
        {word(labels, "frame.security", "Security")}
      </Link>
      {several ? (
        <Link href="/app" className={rowLink}>
          {word(labels, "frame.all", "All workspaces")}
        </Link>
      ) : null}
      <form action={signOut}>
        <button type="submit" className={rowLink}>
          {word(labels, "frame.signout", "Sign out")}
        </button>
      </form>
    </Disclosure>
  );
}
