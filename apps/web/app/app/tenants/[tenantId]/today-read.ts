import { cache } from "react";

import { getBillingAccess } from "@/lib/api/billing-access";
import { getAgentsStatus, getToday } from "@/lib/api/today";

/**
 * `getToday` once per request: the workspace's layout (the count on "Today" in the menu) and the Today page both need it, and one page load should ask the API once.
 * Outside a request (tests, client code) `cache` does not remember, so every call asks.
 */
export const readTodayCached = cache((accessToken: string, tenantId: string) => getToday(accessToken, tenantId));
/** `getBillingAccess` once per request (job DP): the workspace's layout draws the read-only notice from it. */
export const readAccessCached = cache((accessToken: string, tenantId: string) => getBillingAccess(accessToken, tenantId));
/** `getAgentsStatus` once per request too (job DN): Today's team and the Ask dock of the layout both need it. */
export const readAgentsCached = cache((accessToken: string, tenantId: string) => getAgentsStatus(accessToken, tenantId));
