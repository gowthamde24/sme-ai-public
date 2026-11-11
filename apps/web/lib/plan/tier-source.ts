import { ApiAuthError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { planTierScreens } from "@/lib/screens/flag";
import type { ScreenMode } from "@/lib/screens/flag";

import { planScreens } from "./flag";
import { ALL_IN, mockEntitlements, parseEntitlements, type Entitlements } from "./tier";

/**
 * Where the upgrade card's link goes (C1's #317 says `/plans`): the workspace's plans page (`<base>/plans`) while it exists (PLAN_SCREENS on; Owner and Admin only), else Settings -> Plan (its "What's included" card). There is no public
 * plans page in the web app. Sales and Viewers: null (they cannot change the plan; the card says who can). SERVER ONLY (it reads a flag).
 */
export const upgradeHref = (base: string, role: string): string | null => (role !== "owner" && role !== "admin" ? null : planScreens() !== "off" ? `${base}/plans` : `${base}/settings?section=plan`);

/**
 * A workspace's tier (lib/plan/tier.ts), read once per request by the frame (app/app/frame-data.ts). SERVER ONLY, with the signed-in person's own token. `GET /v1/tenants/{t}/billing/entitlements` is C1's draft (any member).
 * Flag off: AI Workforce, nothing asked. `mock`: the fixture. `on`: the API; a route that is not there yet, a failure or an answer that is not the contract's shape is AI Workforce (a tier never hides a feature by accident;
 * the API still refuses what the plan does not have). Only a rejected session is thrown (the page sends the person to sign in).
 */
export async function readEntitlements(token: string, tenantId: string, mode: ScreenMode = planTierScreens()): Promise<Entitlements> {
  if (mode === "off") return ALL_IN;
  if (mode === "mock") return mockEntitlements();
  if (!isCanonicalUuid(tenantId)) return ALL_IN;
  try {
    return parseEntitlements(await apiRequest(`/v1/tenants/${tenantId}/billing/entitlements`, token)) ?? ALL_IN;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return ALL_IN;
  }
}
