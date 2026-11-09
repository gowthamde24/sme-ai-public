import { ApiAuthError } from "@/lib/api/client";
import { getLimits } from "@/lib/api/limits";

import { buildLimits, type Limits } from "./model";

/** Settings > Limits reads the API's own `GET /limits`. One that cannot be read is null and the page says "Not shown yet" (nothing is guessed). A rejected session is thrown. */
export async function readLimits(ctx: { token: string; tenantId: string }): Promise<Limits | null> {
  try {
    return buildLimits(await getLimits(ctx.token, ctx.tenantId));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
