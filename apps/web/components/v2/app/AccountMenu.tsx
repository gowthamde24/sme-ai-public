"use client";

import { ChevronUp, CircleUser } from "lucide-react";
import Link from "next/link";

import { Disclosure } from "./Disclosure";
import { word, type Labels } from "./labels";

const rowLink = "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-ink hover:bg-surface-2";

/** The person's own menu: who is signed in, the Security page, the list of workspaces, and sign out (the same server action the workspaces page uses). In the side menu (`side`) it is the footer and opens upwards, showing who is signed in; on a phone it is the round button in the top bar. */
export function AccountMenu({ email, signOut, labels, side = false }: { email: string | null; signOut: () => Promise<void>; labels?: Labels; side?: boolean }) {
  return (
    <Disclosure
      summaryClassName={
        side
          ? "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-ink hover:bg-surface-2"
          : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2"
      }
      panelClassName={`absolute z-50 rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)] ${side ? "inset-x-0 bottom-full mb-1" : "right-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)]"}`}
      summary={
        <>
          <CircleUser className="size-5 shrink-0" aria-hidden="true" />
          {side ? <span className="min-w-0 flex-1 truncate text-left text-sm">{email ?? word(labels, "frame.account", "Your account")}</span> : null}
          {side ? <ChevronUp className="size-4 shrink-0" aria-hidden="true" /> : null}
          <span className="sr-only">{word(labels, "frame.account", "Your account")}</span>
        </>
      }
    >
      <p className="truncate px-3 py-2 text-sm text-muted">{email ?? word(labels, "frame.account", "Your account")}</p>
      <Link href="/app/security" className={rowLink}>
        {word(labels, "frame.security", "Security")}
      </Link>
      <Link href="/app" className={rowLink}>
        {word(labels, "frame.all", "All workspaces")}
      </Link>
      <form action={signOut}>
        <button type="submit" className={rowLink}>
          {word(labels, "frame.signout", "Sign out")}
        </button>
      </form>
    </Disclosure>
  );
}
