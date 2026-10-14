import { cache } from "react";

import type { FrameData } from "@/components/v2/app/contract";
import { ApiRequestError } from "@/lib/api/client";
import { getPlan } from "@/lib/api/plan";
import { getAiUsage } from "@/lib/api/ai-usage";
import { readPackCached } from "@/lib/packs/read";
import { packFrame } from "@/lib/packs/resolve";

import { readTodayCached } from "./tenants/[tenantId]/today-read";

/**
 * The plan and the AI usage once per request (job CH): the frame (this file) and the Settings page both show them, and one page load should ask the API once. Outside a request (tests, client code) `cache` does not remember,
 * so every call asks, as before.
 */
export const readPlanCached = cache((accessToken: string, tenantId: string) => getPlan(accessToken, tenantId));
export const readUsageCached = cache((accessToken: string, tenantId: string) => getAiUsage(accessToken, tenantId));

/**
 * What the frame shows besides the menu, for ONE workspace: the plan under the business name (`getPlan`), the AI usage card (`getAiUsage`) and the count on Today
 * (`getToday().cards.waiting`). Each is read on its own, so one that fails is null (the frame says "Not available yet" in that one place only). The API gives the AI usage to
 * Owner and Admin only: for anyone else its 403 means the card is not drawn at all (not "Not available yet": there is nothing to wait for). Never throws.
 */
export async function readFrameData(accessToken: string, tenantId: string, lang = "en"): Promise<FrameData> {
  const [plan, usage, today, pack] = await Promise.allSettled([readPlanCached(accessToken, tenantId), readUsageCached(accessToken, tenantId), readTodayCached(accessToken, tenantId), readPackCached(accessToken, tenantId)]);
  return {
    plan: plan.status === "fulfilled" ? plan.value : null,
    usage: usage.status === "fulfilled" ? usage.value : null,
    showUsage: !(usage.status === "rejected" && usage.reason instanceof ApiRequestError && usage.reason.status === 403),
    waiting: today.status === "fulfilled" ? today.value.cards.waiting : null,
    ready: true,
    pack: pack.status === "fulfilled" ? packFrame(pack.value.def, pack.value.modules, lang) : null,
  };
}
