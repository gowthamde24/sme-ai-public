"use client";

import { CircleUser } from "lucide-react";
import Link from "next/link";

import { Disclosure } from "./Disclosure";

const rowLink = "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-ink hover:bg-surface-2";

/** The person's own menu: who is signed in, the Security page, and sign out (the same server action the workspaces page uses). */
export function AccountMenu({ email, signOut }: { email: string | null; signOut: () => Promise<void> }) {
  return (
    <Disclosure
      summaryClassName="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2"
      panelClassName="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]"
      summary={
        <>
          <CircleUser className="size-5" aria-hidden="true" />
          <span className="sr-only">Your account</span>
        </>
      }
    >
      <p className="truncate px-3 py-2 text-sm text-muted">{email ?? "Your account"}</p>
      <Link href="/app/security" className={rowLink}>
        Security
      </Link>
      <form action={signOut}>
        <button type="submit" className={rowLink}>
          Sign out
        </button>
      </form>
    </Disclosure>
  );
}
