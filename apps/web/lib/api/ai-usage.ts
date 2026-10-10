import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * AI usage as a person sees it (job AK / K2): how much of TODAY's and THIS MONTH's AI allowance is used, as percentages, like a usage meter. Server side only, with the signed-in
 * user's own token. `GET /v1/tenants/{tenant}/ai-usage` (Owner and Admin; anyone else gets a 403).
 *
 * No paise, no tokens, no prices ever come through this read. Percent = spent / allowance, rounded DOWN, at most 100. `today` is the Indian day (resets at Indian midnight), `month`
 * runs from the trial start or the billing date in whole months. `state`: "ok", "warn" (80 % or more of either) or "paused" (100 % of either).
 *
 * When a window is at 100 % ONLY the AI features pause (the assistant, research, requirement drafting): quotes, orders, follow-ups and customers keep working. A refused AI call is
 * HTTP 429 with the code `ai_paused_until` and the time it is back in `until` (an ApiRequestError field); `pausedUntil(error)` reads it.
 */
export const AI_USAGE_STATES = ["ok", "warn", "paused"] as const;
export type AiUsageState = (typeof AI_USAGE_STATES)[number];

export interface AiUsage {
  /** 0 to 100, whole numbers. */
  today_percent: number;
  month_percent: number;
  /** ISO 8601 (UTC): the next Indian midnight. */
  resets_at_today: string;
  /** ISO 8601 (UTC): the start of the next monthly window (Indian midnight). */
  resets_at_month: string;
  state: AiUsageState;
}

export const AI_PAUSED_CODE = "ai_paused_until";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an AI usage response.`);
}
function percent(v: unknown, what: string): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100 ? v : bad(what);
}
function when(v: unknown, what: string): string {
  return typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}

export function parseAiUsage(json: unknown): AiUsage {
  if (!isRecord(json)) return bad("usage");
  const state = json.state;
  if (state !== "ok" && state !== "warn" && state !== "paused") return bad("usage state");
  return {
    today_percent: percent(json.today_percent, "today_percent"),
    month_percent: percent(json.month_percent, "month_percent"),
    resets_at_today: when(json.resets_at_today, "resets_at_today"),
    resets_at_month: when(json.resets_at_month, "resets_at_month"),
    state,
  };
}

/** `GET /v1/tenants/{tenant}/ai-usage`. Throws ApiRequestError 403 for Sales and Viewer. */
export async function getAiUsage(accessToken: string, tenantId: string): Promise<AiUsage> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseAiUsage(await apiRequest(`/v1/tenants/${tenantId}/ai-usage`, accessToken));
}

/** When the AI is back, if this error is "the AI is paused" (a 429 `ai_paused_until` with a time); otherwise null. */
export function pausedUntil(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.status !== 429 || error.code !== AI_PAUSED_CODE) return null;
  return error.until && !Number.isNaN(Date.parse(error.until)) ? error.until : null;
}
