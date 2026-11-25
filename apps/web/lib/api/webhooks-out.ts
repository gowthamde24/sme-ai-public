import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, int, optInt, optIso, optStr, readRows, rec, str, uuid, iso } from "./shape";

/**
 * Outbound webhooks and API activity (C1's docs/contracts/webhooks-out.md and developer-api.md, 25 Nov 2026; API flag WEBHOOKS_OUT, 404 while off). SERVER ONLY, with the person's own token. Owner and Admin read; a change needs the second factor. The secret of an endpoint is in
 * the answer of the create and the rotate call ONLY (shown once by the screen); the log has no body and no address, only a status, a count, a code and a closed word for what went wrong.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/developer`;
};
const hookPath = (tenantId: string, id: string, tail = ""): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("webhook id");
  return `${base(tenantId)}/webhooks/${id}${tail}`;
};

export const HEALTH = ["ok", "failing"] as const;
export type Endpoint = { id: string; url: string; events: string[]; sendTranscript: boolean; active: boolean; secretLast4: string; createdAt: string; rotatedAt: string | null; failing: boolean; failingSince: string | null; deadLetters7d: number; lastDeliveredAt: string | null };
export function parseEndpoint(json: unknown): Endpoint {
  const x = rec(json, "webhook");
  const h = rec(x.health ?? {}, "health");
  return {
    id: uuid(x.id, "id"),
    url: str(x.url, "url", 500),
    events: readRows(x.events, "events", (e) => str(e, "event", 40), 20),
    sendTranscript: x.send_transcript === true,
    active: bool(x.active, "active"),
    secretLast4: str(x.secret_last4 ?? "", "secret_last4", 8),
    createdAt: iso(x.created_at, "created_at"),
    rotatedAt: optIso(x.rotated_at, "rotated_at"),
    failing: h.status === "failing",
    failingSince: optIso(h.failing_since, "failing_since"),
    deadLetters7d: optInt(h.dead_letters_7d, "dead_letters_7d", 0, 1_000_000) ?? 0,
    lastDeliveredAt: optIso(h.last_delivered_at, "last_delivered_at"),
  };
}
export const parseEndpoints = (json: unknown): Endpoint[] => readRows(rec(json, "webhooks").items, "items", parseEndpoint, 20);
export type EventKind = { event: string; description: string };
export const parseEvents = (json: unknown): EventKind[] => readRows(rec(json, "events").items, "items", (r) => ({ event: str(rec(r, "event").event, "event", 40), description: str(rec(r, "event").description, "description", 200) }), 20);
export type NewEndpoint = { webhook: Endpoint; secret: string };
export function parseNewEndpoint(json: unknown): NewEndpoint {
  const x = rec(json, "webhook");
  const secret = str(x.secret, "secret", 80);
  if (!secret.startsWith("whsec_")) throw new ApiContractError("secret");
  return { webhook: parseEndpoint(x.webhook), secret };
}
export const DELIVERY_STATUS = ["pending", "retrying", "delivered", "dead"] as const;
export const DELIVERY_ERRORS = ["timeout", "refused", "tls", "status", "redirect", "blocked", "dns", "too_large", "no_secret"] as const;
export type Delivery = { id: string; event: string; status: (typeof DELIVERY_STATUS)[number]; attempts: number; code: number | null; error: (typeof DELIVERY_ERRORS)[number] | null; nextAt: string | null; createdAt: string; deliveredAt: string | null };
export type Deliveries = { items: Delivery[]; nextBefore: string | null };
export function parseDeliveries(json: unknown): Deliveries {
  const x = rec(json, "deliveries");
  return {
    items: readRows(x.items, "items", (r) => {
      const d = rec(r, "delivery");
      const status = (DELIVERY_STATUS as readonly string[]).includes(d.status as string) ? (d.status as Delivery["status"]) : null;
      if (!status) throw new ApiContractError("status");
      const err = (DELIVERY_ERRORS as readonly string[]).includes(d.last_error as string) ? (d.last_error as Delivery["error"]) : null;
      return { id: uuid(d.id, "id"), event: str(d.event, "event", 40), status, attempts: int(d.attempts, "attempts", 0, 100), code: optInt(d.last_status_code, "code", 100, 599), error: err, nextAt: optIso(d.next_attempt_at, "next_attempt_at"), createdAt: iso(d.created_at, "created_at"), deliveredAt: optIso(d.delivered_at, "delivered_at") };
    }, 100),
    nextBefore: optStr(x.next_before, "next_before", 80),
  };
}
export type Counts = { requests: number; leads: number; calls: number; campaigns: number; errors: number };
export type Limits = { requestsPerMinute: number; callsPerMinute: number; campaignsPerMinute: number; concurrentCalls: number };
export type ActivityUsage = { today: Counts; month: Counts; limits: Limits | null };
const counts = (v: unknown, what: string): Counts => {
  const r = rec(v, what);
  const n = (k: string) => optInt(r[k], k, 0, 1_000_000_000) ?? 0;
  return { requests: n("requests"), leads: n("leads"), calls: n("calls_simulated"), campaigns: n("campaigns"), errors: n("errors") };
};
export function parseActivityUsage(json: unknown): ActivityUsage {
  const x = rec(json, "usage");
  const l = x.limits === undefined || x.limits === null ? null : rec(x.limits, "limits");
  const n = (k: string) => (l ? (optInt(l[k], k, 0, 1_000_000) ?? 0) : 0);
  return { today: counts(x.today, "today"), month: counts(x.month, "month"), limits: l ? { requestsPerMinute: n("requests_per_minute"), callsPerMinute: n("calls_per_minute"), campaignsPerMinute: n("campaigns_per_minute"), concurrentCalls: n("concurrent_calls") } : null };
}
export type ActivityRow = { id: string; keyName: string; method: string; route: string; status: number; latencyMs: number; at: string };
export type Activity = { items: ActivityRow[]; nextBefore: string | null };
export function parseActivity(json: unknown): Activity {
  const x = rec(json, "activity");
  return {
    items: readRows(x.items, "items", (r) => {
      const a = rec(r, "row");
      return { id: str(a.id, "id", 80), keyName: str(a.key_name ?? "", "key_name", 80), method: str(a.method, "method", 10), route: str(a.route, "route", 160), status: int(a.status, "status", 100, 599), latencyMs: optInt(a.latency_ms, "latency_ms", 0, 600_000) ?? 0, at: iso(a.at, "at") };
    }, 100),
    nextBefore: optStr(x.next_before, "next_before", 80),
  };
}

export type HookFail = { ok: false; error: "url" | "too_many" | "unavailable" | "forbidden" | "mfa" | "other"; reason?: string };
const URL_REASONS = ["length", "scheme", "userinfo", "host", "port", "private", "dns"];
export function hookFailOf(error: unknown): HookFail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return { ok: false, error: "mfa" };
    if (error.code === "webhook_url_invalid") {
      const r = error.reason ?? error.extra?.fields?.[0];
      return { ok: false, error: "url", ...(r && URL_REASONS.includes(r) ? { reason: r } : {}) };
    }
    if (error.code === "too_many_webhooks") return { ok: false, error: "too_many" };
    if (error.code === "webhooks_out_unavailable") return { ok: false, error: "unavailable" };
    if (error.status === 403) return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "other" };
}

const post = (path: string, token: string, body: unknown = {}, method = "POST"): Promise<unknown> => apiRequest(path, token, { method, body: JSON.stringify(body) });
export const listEndpoints = async (token: string, t: string): Promise<Endpoint[]> => parseEndpoints(await apiRequest(`${base(t)}/webhooks`, token));
export const listEvents = async (token: string, t: string): Promise<EventKind[]> => parseEvents(await apiRequest(`${base(t)}/webhooks/events`, token));
export type HookInput = { url: string; events: string[]; sendTranscript: boolean };
export const createEndpoint = async (token: string, t: string, i: HookInput): Promise<NewEndpoint> => parseNewEndpoint(await post(`${base(t)}/webhooks`, token, { url: i.url, events: i.events, send_transcript: i.sendTranscript }));
export const changeEndpoint = async (token: string, t: string, id: string, patch: Partial<HookInput> & { active?: boolean }): Promise<Endpoint> => {
  const body: Record<string, unknown> = {};
  if (patch.url !== undefined) body.url = patch.url;
  if (patch.events !== undefined) body.events = patch.events;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.sendTranscript !== undefined) body.send_transcript = patch.sendTranscript;
  return parseEndpoint(rec(await post(hookPath(t, id), token, body, "PATCH"), "changed").webhook);
};
export const rotateEndpointSecret = async (token: string, t: string, id: string): Promise<NewEndpoint> => parseNewEndpoint(await post(hookPath(t, id, "/rotate-secret"), token));
export const deleteEndpoint = async (token: string, t: string, id: string): Promise<void> => void (await apiRequest(hookPath(t, id), token, { method: "DELETE" }));
export const testEndpoint = async (token: string, t: string, id: string): Promise<void> => void (await post(hookPath(t, id, "/test"), token));
export async function listDeliveries(token: string, t: string, id: string, before: string | null): Promise<Deliveries> {
  const q = new URLSearchParams({ limit: "20" });
  if (before) q.set("before", before);
  return parseDeliveries(await apiRequest(`${hookPath(t, id, "/deliveries")}?${q.toString()}`, token));
}
export const getActivityUsage = async (token: string, t: string): Promise<ActivityUsage> => parseActivityUsage(await apiRequest(`${base(t)}/usage`, token));
export async function listActivity(token: string, t: string, before: string | null): Promise<Activity> {
  const q = new URLSearchParams({ limit: "30" });
  if (before) q.set("before", before);
  return parseActivity(await apiRequest(`${base(t)}/activity?${q.toString()}`, token));
}
