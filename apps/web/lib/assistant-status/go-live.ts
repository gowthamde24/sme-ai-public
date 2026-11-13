import { cookies } from "next/headers";

import { ApiAuthError, ApiRequestError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { assistantStatusScreens } from "@/lib/screens/flag";

import { COOKIE, readAssistantStatus } from "./source";
import { isState, parseStatus, type AssistantStatus, type Missing } from "./types";

/**
 * Go live and Pause, and what is missing for it (design system v6, owner 13 Nov 2026; C1's `POST /v1/tenants/{t}/assistant/go-live` and `/pause`, docs/contracts/assistant-status.md). `1` = the API (a 409 `assistant_not_ready` is answered with the status that says what is missing);
 * `mock` = the one cookie of `readAssistantStatus` (`sme_assistant_state`) plus a made-up connected phone number kept in a second cookie, so staging can show the whole day-one path before the API and the telephony exist. Only a business name of its own and a connected phone number are
 * needed (the placeholder "My business" does not count); nothing else. SERVER ONLY. Never throws for the browser: it answers a closed word.
 */
export const PHONE_COOKIE = "sme_assistant_phone";
/** The made-up number the mock "connects" (staging only). It is a test number, drawn only masked. */
export const MOCK_NUMBER = "+91 90000 00421";
/** The name a workspace has until the owner gives it a business name of its own (the contract's placeholder). */
export const PLACEHOLDER_NAME = "My business";

export const hasOwnName = (name: string | null | undefined): boolean => typeof name === "string" && name.trim() !== "" && name.trim().toLowerCase() !== PLACEHOLDER_NAME.toLowerCase();

const COOKIE_DAYS = 60 * 60 * 24 * 14;
const attrs = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: COOKIE_DAYS, path: "/" };

/** The mock's connected phone number, or null. */
export async function readMockPhone(): Promise<string | null> {
  try {
    const v = (await cookies()).get(PHONE_COOKIE)?.value;
    return v === MOCK_NUMBER ? v : null;
  } catch {
    return null;
  }
}
/** Staging only (mock): "connects" the made-up test number. False where the status is not a mock. */
export async function connectMockPhone(): Promise<boolean> {
  if (assistantStatusScreens() !== "mock") return false;
  (await cookies()).set(PHONE_COOKIE, MOCK_NUMBER, attrs);
  return true;
}

/** What is still needed to go live, from what is known: the API's own list (`1`), or the business name and the mock's phone (`mock`). Null = not known (no status). */
export async function missingFor(status: AssistantStatus | null, shop: string): Promise<Missing[] | null> {
  if (status === null) return null;
  if (assistantStatusScreens() !== "mock") return status.missing;
  const out: Missing[] = [];
  if (!hasOwnName(shop)) out.push("business_name");
  if ((await readMockPhone()) === null) out.push("phone_number");
  return out;
}

export type Moved = { ok: true; status: AssistantStatus } | { ok: false; error: "missing" | "forbidden" | "not_available" | "down"; missing: Missing[] };

async function move(token: string, tenantId: string, to: "go-live" | "pause", shop: string): Promise<Moved> {
  const mode = assistantStatusScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return { ok: false, error: "not_available", missing: [] };
  if (mode === "mock") {
    const before = await readAssistantStatus(token, tenantId);
    const missing = (await missingFor(before, shop)) ?? [];
    if (to === "go-live" && missing.length > 0) return { ok: false, error: "missing", missing };
    const state = to === "go-live" ? "live" : "not_live";
    (await cookies()).set(COOKIE, state, attrs);
    return { ok: true, status: { state: isState(state) ? state : "not_live", canGoLive: true, missing: [], usingDefaults: before?.usingDefaults ?? [] } };
  }
  try {
    const status = parseStatus(await apiRequest(`/v1/tenants/${tenantId}/assistant/${to}`, token, { method: "POST" }));
    return status ? { ok: true, status } : { ok: false, error: "down", missing: [] };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.status === 409) {
        const now = await readAssistantStatus(token, tenantId);
        return { ok: false, error: "missing", missing: now?.missing ?? [] };
      }
      if (error.status === 403) return { ok: false, error: "forbidden", missing: [] };
      if (error.status === 404 || error.status === 405) return { ok: false, error: "not_available", missing: [] };
    }
    return { ok: false, error: "down", missing: [] };
  }
}

/** "Go live with defaults". `shop` is the business's name (the mock needs it; the API knows it). */
export const goLive = (token: string, tenantId: string, shop: string): Promise<Moved> => move(token, tenantId, "go-live", shop);
export const pause = (token: string, tenantId: string, shop = ""): Promise<Moved> => move(token, tenantId, "pause", shop);
