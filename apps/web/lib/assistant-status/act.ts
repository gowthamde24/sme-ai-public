import { cookies } from "next/headers";

import { ApiRequestError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { assistantStatusScreens } from "@/lib/screens/flag";

import { COOKIE, readAssistantStatus } from "./source";
import { parseStatus, PARTS, type AssistantStatus, type Missing } from "./types";

/**
 * Go live and Pause (owner, 13 Nov 2026; C1's docs/contracts/assistant-status.md): `1` = `POST /v1/tenants/{t}/assistant/go-live|pause` (Owner, no second factor; going live without what is missing is a 409 `assistant_not_ready`, and the status is read again to
 * learn WHAT is missing); `mock` = the state kept in the cookie of the browser (`sme_assistant_state`; the mock business always has its name and a phone number, so going live works), off = not there. The answer is a closed word, never the API's text. SERVER ONLY.
 */
export type Act = "go-live" | "pause";
export type ActResult =
  | { ok: true; status: AssistantStatus }
  | { ok: false; error: "not_ready"; missing: Missing[] }
  | { ok: false; error: "forbidden" | "not_available" | "down" };

export async function actOnAssistant(token: string, tenantId: string, act: Act): Promise<ActResult> {
  const mode = assistantStatusScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const state = act === "go-live" ? "live" : "in_training";
    try {
      (await cookies()).set(COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7, path: "/" });
    } catch {
      return { ok: false, error: "down" };
    }
    return { ok: true, status: { state, canGoLive: true, missing: [], usingDefaults: state === "live" ? [] : [...PARTS] } };
  }
  try {
    const status = parseStatus(await apiRequest(`/v1/tenants/${tenantId}/assistant/${act}`, token, { method: "POST" }));
    return status ? { ok: true, status } : { ok: false, error: "down" };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 409 && error.code === "assistant_not_ready") {
        const again = await readAssistantStatus(token, tenantId);
        return { ok: false, error: "not_ready", missing: again?.missing ?? [] };
      }
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404 || error.status === 405) return { ok: false, error: "not_available" };
    }
    return { ok: false, error: "down" };
  }
}
