import { ApiAuthError } from "@/lib/api/client";
import { listAssistantActions } from "@/lib/api/assistant-work";
import type { ScreenMode } from "@/lib/screens/flag";

import { ACTIVITY_JSON, FIXTURE_NOW } from "./fixtures";
import { parseActivity, sinceFor, type ActivityEntry } from "./types";

/**
 * Settings > Activity's list (SERVER ONLY): `mock` = the synthetic entries, judged against the fixtures' own clock (so "today" stays the fixtures' today); `on` = the API (C1's contract,
 * docs/contracts/assistant-tools.md: `GET /assistant/actions?since`). A read that fails is null (the card says "Not available yet"); a rejected session is thrown.
 */
export async function readActivity(mode: Exclude<ScreenMode, "off">, ctx: { token: string; tenantId: string }, range: "today" | "week", now: number = Date.now()): Promise<ActivityEntry[] | null> {
  if (mode === "mock") {
    const since = Date.parse(sinceFor(range, FIXTURE_NOW));
    return (parseActivity(ACTIVITY_JSON)?.items ?? []).filter((e) => Date.parse(e.at) >= since);
  }
  try {
    return (await listAssistantActions(ctx.token, ctx.tenantId, sinceFor(range, now))).items;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
