"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { itemFor, workspaceOf, type Role } from "./nav";

export type Membership = { id: string; name: string; role: Role };

/**
 * Which workspace (and which role in it) the address belongs to, taken from the memberships `/v1/me` returned. The role is the one the API
 * gave for THAT workspace; a workspace that is not in the list gives null (the frame then draws the account part only, and the page shows its own not-found).
 */
export function useWorkspace(memberships: readonly Membership[]): { current: Membership | null; tenantId: string | null; pathname: string; tab: string | null; active: ReturnType<typeof itemFor> } {
  const pathname = usePathname() ?? "/app";
  const tab = useSearchParams()?.get("tab") ?? null;
  const ws = workspaceOf(pathname);
  const current = ws ? (memberships.find((m) => m.id.toLowerCase() === ws.tenantId.toLowerCase()) ?? null) : null;
  return { current, tenantId: current?.id ?? null, pathname, tab, active: itemFor(pathname, tab) };
}
