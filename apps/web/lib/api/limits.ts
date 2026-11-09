import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Settings > Limits on the API's own answer (C1's docs/contracts/activity-limits.md): `GET /v1/tenants/{t}/limits` (Owner, Admin). The page shows what the database says and never computes a mode itself; it is read-only here (PUT /limits, tighten-only,
 * is the Owner's and is not offered in the app yet). A locked kind (quotes, price changes, payments, deleting data, a sensitive message) always asks the Owner: no toggle. Call kinds exist only once the assistant's settings were saved.
 */
export const KIND_KEYS = ["message_routine", "message_other", "message_sensitive", "call_prices", "call_visits", "call_media", "call_dues", "quote_send", "price_change", "payment", "delete_data"] as const;
export type KindKey = (typeof KIND_KEYS)[number];
export type LimitKind = { kind: KindKey; mode: "alone" | "needs_ok"; locked: boolean };
export type Cap = { key: "messages_per_customer_per_day" | "call_discount_percent" | "call_big_order_paise"; value: number | null; unit: string };
export type CallHours = { days: number[]; from: number; to: number; source: "assistant" | "call_settings" | "default" };
export type LimitsOut = {
  workspaceOn: boolean;
  platformOn: boolean;
  assistantSaved: boolean;
  kinds: LimitKind[];
  caps: Cap[];
  messageHours: { start: number; end: number } | null;
  callHours: CallHours | null;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseLimits(json: unknown): LimitsOut {
  if (!isRec(json) || !Array.isArray(json.kinds) || !isRec(json.workspace)) throw new ApiContractError("Unexpected limits.");
  const kinds: LimitKind[] = [];
  for (const k of json.kinds.slice(0, 30)) {
    if (!isRec(k) || !(KIND_KEYS as readonly unknown[]).includes(k.kind) || (k.mode !== "alone" && k.mode !== "needs_ok")) continue; // a kind we do not know is left out, never drawn wrong
    kinds.push({ kind: k.kind as KindKey, mode: k.mode, locked: k.locked === true });
  }
  const caps: Cap[] = [];
  for (const c of Array.isArray(json.caps) ? json.caps.slice(0, 10) : []) {
    if (!isRec(c) || !["messages_per_customer_per_day", "call_discount_percent", "call_big_order_paise"].includes(String(c.key))) continue;
    const value = c.value === null ? null : int(c.value, 0, 1_000_000_000_000);
    if (c.value !== null && value === null) continue;
    caps.push({ key: c.key as Cap["key"], value, unit: typeof c.unit === "string" ? c.unit.slice(0, 20) : "" });
  }
  const q = isRec(json.quiet_hours) ? json.quiet_hours : null;
  const m = q && isRec(q.messages) ? q.messages : null;
  const c = q && isRec(q.calls) ? q.calls : null;
  const start = m ? int(m.start_hour, 0, 23) : null;
  const end = m ? int(m.end_hour, 0, 24) : null;
  const from = c ? int(c.from_minute, 0, 1440) : null;
  const to = c ? int(c.to_minute, 0, 1440) : null;
  const days = c && Array.isArray(c.days) ? c.days.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 7).slice(0, 7) : [];
  return {
    workspaceOn: json.workspace.on !== false,
    platformOn: json.workspace.platform_on !== false,
    assistantSaved: json.assistant_saved === true,
    kinds,
    caps,
    messageHours: start !== null && end !== null ? { start, end } : null,
    callHours: from !== null && to !== null && c ? { days, from, to, source: c.source === "assistant" || c.source === "call_settings" ? c.source : "default" } : null,
  };
}

export async function getLimits(token: string, tenantId: string): Promise<LimitsOut> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseLimits(await apiRequest(`/v1/tenants/${tenantId}/limits`, token));
}
