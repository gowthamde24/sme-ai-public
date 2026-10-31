import { apiRequest } from "@/lib/api/client";
import { activityScreens } from "@/lib/screens/flag";

import { parseActivity, type ActivityFeed, type ActivityItem } from "./types";

/**
 * Where the "Live now" strip's data comes from (SERVER ONLY): `mock` = made-up activity that changes every 15 seconds (a call with three chats, then two leads being read, then nothing), `on` = the API's `GET /assistant/activity`, `off` = the strip is
 * not drawn. A read that fails is null (the strip then says nothing, never a wrong line).
 */
export async function readActivity(token: string, tenantId: string, now: number = Date.now()): Promise<ActivityFeed | null> {
  const mode = activityScreens();
  if (mode === "off") return null;
  if (mode === "mock") {
    const phase = Math.floor(now / 15_000) % 3;
    const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
    const items: ActivityItem[] =
      phase === 0
        ? [{ type: "call", who: "Ramesh", elapsedS: 134, target: { kind: "task", id: id(1) } }, { type: "whatsapp_reply", who: "Anitha", elapsedS: 20, target: { kind: "conversation", id: id(2) } }, { type: "whatsapp_reply", who: "Kiran", elapsedS: 41, target: { kind: "conversation", id: id(3) } }, { type: "follow_up", who: "Lakshmi", elapsedS: 12, target: { kind: "conversation", id: id(4) } }]
        : phase === 1
          ? [{ type: "lead_read", who: null, elapsedS: 8, target: { kind: "lead", id: id(5) } }, { type: "lead_read", who: null, elapsedS: 3, target: { kind: "lead", id: id(6) } }]
          : [];
    return { items, pollAfterS: 5 };
  }
  try {
    return parseActivity(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/assistant/activity`, token));
  } catch {
    return null;
  }
}
