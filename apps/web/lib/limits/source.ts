import { ApiAuthError } from "@/lib/api/client";
import { fetchPolicyVersions } from "@/lib/api/followups";
import { getOutboxSettings } from "@/lib/api/outbox";
import { fetchQuotePolicyVersions } from "@/lib/api/quote-policies";
import { readAutoReply } from "@/lib/auto-reply/source";

import { buildLimits, inForce, type Limits } from "./model";

/** Settings > Limits reads four real settings, each on its own: one that cannot be read is null, and the page says "Not shown yet" for it (nothing is guessed). A rejected session is thrown. */
export async function readLimits(ctx: { token: string; tenantId: string }, now: number = Date.now()): Promise<Limits> {
  const settle = async <T>(p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      return null;
    }
  };
  const [outbox, auto, quotes, follows] = await Promise.all([
    settle(getOutboxSettings(ctx.token, ctx.tenantId)),
    settle(readAutoReply(ctx)),
    settle(fetchQuotePolicyVersions(ctx.token, ctx.tenantId)),
    settle(fetchPolicyVersions(ctx.token, ctx.tenantId)),
  ]);
  return buildLimits({ outbox, autoReply: auto?.mode === "ok" ? auto.data : null, quote: inForce(quotes, now), followup: inForce(follows, now) });
}
