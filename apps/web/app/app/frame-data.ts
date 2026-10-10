import type { FrameData } from "@/components/v2/app/contract";
import { ApiRequestError } from "@/lib/api/client";
import { getPlan } from "@/lib/api/plan";
import { getAiUsage } from "@/lib/api/ai-usage";

import { readTodayCached } from "./tenants/[tenantId]/today-read";

/**
 * What the frame shows besides the menu, for ONE workspace: the plan under the business name (`getPlan`), the AI usage card (`getAiUsage`) and the count on Today
 * (`getToday().cards.waiting`). Each is read on its own, so one that fails is null (the frame says "Not available yet" in that one place only). The API gives the AI usage to
 * Owner and Admin only: for anyone else its 403 means the card is not drawn at all (not "Not available yet": there is nothing to wait for). Never throws.
 */
export async function readFrameData(accessToken: string, tenantId: string): Promise<FrameData> {
  const [plan, usage, today] = await Promise.allSettled([getPlan(accessToken, tenantId), getAiUsage(accessToken, tenantId), readTodayCached(accessToken, tenantId)]);
  return {
    plan: plan.status === "fulfilled" ? plan.value : null,
    usage: usage.status === "fulfilled" ? usage.value : null,
    showUsage: !(usage.status === "rejected" && usage.reason instanceof ApiRequestError && usage.reason.status === 403),
    waiting: today.status === "fulfilled" ? today.value.cards.waiting : null,
    ready: true,
  };
}
