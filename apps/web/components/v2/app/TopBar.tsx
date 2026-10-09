"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./frame-parts";
import type { Labels } from "./labels";
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * The bar across the top of the page: on a phone the orange mark (to the home of the workspace) on the left; on the right the language and the light/dark controls
 * (`children`, drawn by the server in the chosen language). Outside a workspace the phone has no bottom bar, so the user menu sits here instead.
 */
export function TopBar({ memberships, labels, email, signOut, children }: { memberships: readonly Membership[]; labels?: Labels; email: string | null; signOut: () => Promise<void>; children: ReactNode }) {
  const { current } = useWorkspace(memberships);
  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-8">
      <Link href={current ? `/app/tenants/${current.id}` : "/app"} className="rounded-lg md:hidden" aria-label={current?.name ?? "Home"}>
        <BrandMark className="size-9" />
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {children}
        {current ? null : (
          <div className="md:hidden">
            <AccountMenu email={email} signOut={signOut} labels={labels} down several={memberships.length > 1} />
          </div>
        )}
      </div>
    </header>
  );
}
