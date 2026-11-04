import { cache } from "react";

import type { FrameData } from "@/components/v2/app/contract";
import { ApiRequestError } from "@/lib/api/client";
import { getPlan } from "@/lib/api/plan";
import { getAiUsage } from "@/lib/api/ai-usage";
import { getWorkspaceProfile } from "@/lib/api/workspace";
import { readAvailability } from "@/lib/api/lead-finder";
import { finderAccess, type Availability, type FinderAccess } from "@/lib/lead-finder/types";
import { readEntitlements } from "@/lib/plan/tier-source";
import { LEAD_DESK, type Entitlements } from "@/lib/plan/tier";
import { readPackCached } from "@/lib/packs/read";
import { packFrame } from "@/lib/packs/resolve";
import { activityScreens } from "@/lib/screens/flag";

import { readTodayCached } from "./tenants/[tenantId]/today-read";

/**
 * The plan and the AI usage once per request (job CH): the frame (this file) and the Settings page both show them, and one page load should ask the API once. Outside a request (tests, client code) `cache` does not remember,
 * so every call asks, as before.
 */
export const readPlanCached = cache((accessToken: string, tenantId: string) => getPlan(accessToken, tenantId));
/** The business profile (its logo) once per request: the menu draws the logo; any member may read it. */
export const readProfileCached = cache((accessToken: string, tenantId: string) => getWorkspaceProfile(accessToken, tenantId));
export const readUsageCached = cache((accessToken: string, tenantId: string) => getAiUsage(accessToken, tenantId));
/** Whether the Lead Finder is here at all (`GET /lead-finder/availability`), once per request: the frame, Today and Settings all ask. Null = cannot tell (hidden). */
export const readFinderCached = cache((accessToken: string, tenantId: string) => readAvailability(accessToken, tenantId));
/** The workspace's plan tier (AI Workforce or Lead Desk, lib/plan/tier-source.ts), once per request. Never fails except for a rejected session: a tier that cannot be told is AI Workforce. */
export const readEntitlementsCached = cache((accessToken: string, tenantId: string) => readEntitlements(accessToken, tenantId));
/**
 * What the screens do with the Lead Finder (`on`, `upsell` or `hidden`: lib/lead-finder/types.ts `finderAccess`), from its availability and the plan tier, once per request: the frame, Today, the Prospects tab, Settings and the
 * chat all ask. Only a rejected session is thrown.
 */
export const readFinderAccessCached = cache(async (accessToken: string, tenantId: string): Promise<{ access: FinderAccess; availability: Availability | null; plan: Entitlements }> => {
  const [availability, plan] = await Promise.all([readFinderCached(accessToken, tenantId), readEntitlementsCached(accessToken, tenantId)]);
  // the Lead Finder's own `not_in_plan` (C1's #317) means the plan is Lead Desk even where the tier is not read (the flag is off): the badge and the card agree
  return { access: finderAccess(availability, plan.features.leadFinder), availability, plan: availability?.reason === "not_in_plan" && plan.features.leadFinder ? LEAD_DESK : plan };
});

/**
 * What the frame shows besides the menu, for ONE workspace: the plan under the business name (`getPlan`), the AI usage card (`getAiUsage`) and the count on Today
 * (`getToday().cards.waiting`). Each is read on its own, so one that fails is null (the frame says "Not available yet" in that one place only). The API gives the AI usage to
 * Owner and Admin only: for anyone else its 403 means the card is not drawn at all (not "Not available yet": there is nothing to wait for). Never throws.
 */
export async function readFrameData(accessToken: string, tenantId: string, lang = "en"): Promise<FrameData> {
  const [plan, usage, today, pack, profile, finder] = await Promise.allSettled([readPlanCached(accessToken, tenantId), readUsageCached(accessToken, tenantId), readTodayCached(accessToken, tenantId), readPackCached(accessToken, tenantId), readProfileCached(accessToken, tenantId), readFinderAccessCached(accessToken, tenantId)]);
  // the Lead Finder (its Prospects tab) only where the API says it is available, or where only the plan keeps it away (Lead Desk: the tab opens the "part of AI Workforce" card); a business type without it, a switched-off one
  // or one that cannot be told is hidden like a module the business type does not have
  const finderOn = finder.status === "fulfilled" && finder.value.access !== "hidden";
  const frame = pack.status === "fulfilled" && pack.value ? packFrame(pack.value, lang) : null;
  return {
    plan: plan.status === "fulfilled" ? plan.value : null,
    usage: usage.status === "fulfilled" ? usage.value : null,
    showUsage: !(usage.status === "rejected" && usage.reason instanceof ApiRequestError && usage.reason.status === 403),
    waiting: today.status === "fulfilled" ? today.value.cards.waiting : null,
    ready: true,
    live: activityScreens() !== "off",
    logoUrl: profile.status === "fulfilled" ? profile.value.logoUrl : null,
    pack: frame && !finderOn && frame.modules.includes("lead_finder") ? { ...frame, modules: frame.modules.filter((m) => m !== "lead_finder") } : frame,
  };
}
