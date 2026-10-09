"use client";

import { CircleUser } from "lucide-react";
import Link from "next/link";

import { Disclosure } from "./Disclosure";
import { word, type Labels } from "./labels";

const rowLink = "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-ink hover:bg-surface-2";

/** The person's own menu: who is signed in, the Security page, and sign out (the same server action the workspaces page uses). */
export function AccountMenu({ email, signOut, labels }: { email: string | null; signOut: () => Promise<void>; labels?: Labels }) {
  return (
    <Disclosure
      summaryClassName="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink hover:bg-surface-2"
      panelClassName="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-[var(--v2-shadow-pop)]"
      summary={
        <>
          <CircleUser className="size-5" aria-hidden="true" />
          <span className="sr-only">{word(labels, "frame.account", "Your account")}</span>
        </>
      }
    >
      <p className="truncate px-3 py-2 text-sm text-muted">{email ?? word(labels, "frame.account", "Your account")}</p>
      <Link href="/app/security" className={rowLink}>
        {word(labels, "frame.security", "Security")}
      </Link>
      <form action={signOut}>
        <button type="submit" className={rowLink}>
          {word(labels, "frame.signout", "Sign out")}
        </button>
      </form>
    </Disclosure>
  );
}
