import { cookies } from "next/headers";

import { apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { assistantStatusScreens } from "@/lib/screens/flag";

import { isState, parseStatus, PARTS, type AssistantStatus } from "./types";

/**
 * Where the menu and My assistant get the assistant's status. `1` = C1's `GET /v1/tenants/{t}/assistant/status`; `mock` = ONE cookie of the browser (`sme_assistant_state`: the state), with the business name known and a made-up phone number connected (staging until the API has it); off = no status. A failed read is null.
 */
export const COOKIE = "sme_assistant_state";

export async function readAssistantStatus(accessToken: string, tenantId: string): Promise<AssistantStatus | null> {
  const mode = assistantStatusScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  if (mode === "mock") {
    let value: string | undefined;
    try {
      value = (await cookies()).get(COOKIE)?.value;
    } catch {
      value = undefined;
    }
    const state = isState(value) ? value : "not_live";
    return { state, canGoLive: true, missing: [], usingDefaults: state === "live" ? [] : [...PARTS] };
  }
  try {
    return parseStatus(await apiRequest(`/v1/tenants/${tenantId}/assistant/status`, accessToken));
  } catch {
    return null;
  }
}
