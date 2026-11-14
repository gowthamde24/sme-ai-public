import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * "Ask first" (the owner's decision, 14 Nov 2026; C1's contract docs/contracts/conversation.md "Plan card, 14 Nov" and "Ask first in Needs you"): consent is strict for EVERY plan, and the people whose consent is still unknown are NOT called. Two ways to bring them in, both the Owner's, no authenticator code:
 *   `whatsapp`        each gets a short "reply OK" message through the outbox. It is NOT consent until the person agrees (nothing is recorded by the message).
 *   `owner_confirms`  "I confirm they agreed" (said in the shop, on a call): consent is recorded, the plan is made again for them.
 * SERVER ONLY, the signed-in person's own token. The API's words are never passed on: the answers are numbers and closed codes, and the screens write the sentences.
 */
export type AskHow = "whatsapp" | "owner_confirms";
export type AskConsentResult = {
  how: AskHow;
  asked: number;
  /** whatsapp only: how many messages were queued, how many could not be (by closed reason code) and whether a template is registered. */
  queued: number | null;
  blocked: number | null;
  blockedReasons: Record<string, number>;
  templateStatus: string | null;
  /** owner_confirms on a plan that waits for its yes: the NEW plan card (the old one is dead), as the API sent it (parsed by the caller). */
  newAction: Record<string, unknown> | null;
  /** owner_confirms on a plan that already started: the NEW planned task for the people who agreed. */
  newTaskId: string | null;
};

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parseAskConsent(json: unknown): AskConsentResult {
  const o = rec(json);
  const how = o?.how;
  const asked = o ? whole(o.asked) : null;
  if (!o || (how !== "whatsapp" && how !== "owner_confirms") || asked === null) throw new ApiContractError("Unexpected ask-consent response.");
  return {
    how,
    asked,
    queued: whole(o.queued),
    blocked: whole(o.blocked),
    blockedReasons: Object.fromEntries(Object.entries(rec(o.blocked_reasons) ?? {}).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && whole(v) !== null) as [string, number][]),
    templateStatus: typeof o.template_status === "string" && /^[a-z_]{1,40}$/.test(o.template_status) ? o.template_status : null,
    newAction: rec(o.new_action),
    newTaskId: typeof o.new_task_id === "string" && isCanonicalUuid(o.new_task_id) ? o.new_task_id : null,
  };
}

const body = (how: AskHow) => JSON.stringify({ how, all_skipped: true });

/** Ask (or confirm for) the people a plan that still waits for its yes left out. Throws ApiRequestError: 409 `action_state`, 422 `nobody_to_ask`, 403 `forbidden`. */
export async function askConsentForPlan(token: string, tenantId: string, actionId: string, how: AskHow): Promise<AskConsentResult> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(actionId)) throw new ApiContractError("id");
  return parseAskConsent(await apiRequest(`/v1/tenants/${tenantId}/assistant/actions/${actionId}/ask-consent`, token, { method: "POST", body: body(how) }));
}

/** The same for a plan (task) in ANY state: the "ask first" item of Needs you. */
export async function askConsentForTask(token: string, tenantId: string, taskId: string, how: AskHow): Promise<AskConsentResult> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(taskId)) throw new ApiContractError("id");
  return parseAskConsent(await apiRequest(`/v1/tenants/${tenantId}/tasks/${taskId}/ask-consent`, token, { method: "POST", body: body(how) }));
}

export type AskFirstItem = { taskId: string; goal: string; channel: "call" | "whatsapp" | "both" | null; status: string; createdAt: string; people: number; asked: number };

export function parseAskFirst(json: unknown): AskFirstItem[] {
  const items = rec(json)?.items;
  if (!Array.isArray(items)) throw new ApiContractError("Unexpected ask-first response.");
  return items.flatMap((x): AskFirstItem[] => {
    const o = rec(x);
    const people = o ? whole(o.people) : null;
    if (!o || typeof o.task_id !== "string" || !isCanonicalUuid(o.task_id) || people === null || people === 0 || typeof o.created_at !== "string" || Number.isNaN(Date.parse(o.created_at))) return [];
    return [{ taskId: o.task_id, goal: typeof o.goal === "string" ? o.goal.slice(0, 200) : "", channel: o.channel === "call" || o.channel === "whatsapp" || o.channel === "both" ? o.channel : null, status: typeof o.status === "string" ? o.status.slice(0, 20) : "", createdAt: o.created_at, people, asked: whole(o.asked) ?? 0 }];
  });
}

/** The plans that left out people whose consent is unknown (Owner and Admin; the last 14 days). */
export async function readAskFirst(token: string, tenantId: string): Promise<AskFirstItem[]> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return parseAskFirst(await apiRequest(`/v1/tenants/${tenantId}/tasks/ask-first`, token));
}

/** Closes the item without asking anyone (Owner; audited; 204). */
export async function dismissAskFirst(token: string, tenantId: string, taskId: string): Promise<void> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(taskId)) throw new ApiContractError("id");
  await apiRequest(`/v1/tenants/${tenantId}/tasks/${taskId}/ask-first/dismiss`, token, { method: "POST", body: "{}" });
}

/** What the screens get back from an ask: the numbers and closed codes (never the API's words), or one closed error word. */
export type AskOutcome = { ok: true; result: AskConsentResult } | { ok: false; error: "state" | "nobody" | "forbidden" | "down" };

/** A failed ask as a closed word: `state` (the plan is not waiting any more), `nobody` (nobody left to ask), `forbidden` (only the Owner may), else `down`. A rejected session is for the caller to send to sign-in. */
export function askErrorOf(error: unknown): "state" | "nobody" | "forbidden" | "down" {
  const e = error as { status?: unknown; code?: unknown } | null;
  if (e && typeof e.code === "string") {
    if (e.code === "action_state" || e.code === "task_state" || e.status === 409) return "state";
    if (e.code === "nobody_to_ask") return "nobody";
    if (e.code === "forbidden" || e.status === 403) return "forbidden";
  }
  return "down";
}
