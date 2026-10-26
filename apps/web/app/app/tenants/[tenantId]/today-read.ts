import { cache } from "react";

import { getBillingAccess } from "@/lib/api/billing-access";
import { isDemoWorkspace } from "@/lib/workspace-demo";
import { getAgentsStatus, getToday } from "@/lib/api/today";

/**
 * `getToday` once per request: the workspace's layout (the count on "Today" in the menu) and the Today page both need it, and one page load should ask the API once.
 * Outside a request (tests, client code) `cache` does not remember, so every call asks.
 */
export const readTodayCached = cache((accessToken: string, tenantId: string) => getToday(accessToken, tenantId));
/** `getBillingAccess` once per request (job DP): the workspace's layout draws the read-only notice from it. */
export const readAccessCached = cache((accessToken: string, tenantId: string) => getBillingAccess(accessToken, tenantId));

/** Is this a demo workspace? The API's own `demo` word (on `billing/access`) when it sends one, else the name hint; a failed read falls back to the name (it only chooses wording). */
export async function readIsDemo(accessToken: string, tenantId: string, name: string | null | undefined): Promise<boolean> {
  try {
    return isDemoWorkspace(name, (await readAccessCached(accessToken, tenantId)).demo);
  } catch {
    return isDemoWorkspace(name);
  }
}
/** `getAgentsStatus` once per request too (job DN): Today's team and the Ask dock of the layout both need it. */
export const readAgentsCached = cache((accessToken: string, tenantId: string) => getAgentsStatus(accessToken, tenantId));
