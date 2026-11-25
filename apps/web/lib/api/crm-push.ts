import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, int, iso, optInt, optIso, optStr, readRows, rec, str, uuid } from "./shape";

/**
 * Results into the business's own CRM or sheet (C1's docs/contracts/crm-push.md, 25 Nov 2026; API flag CRM_PUSH, 404 while off). SERVER ONLY, with the person's own token. Owner and Admin read; a change needs the second factor.
 * A key is typed into the connect form and goes to the API ONLY: no answer carries one, so none can be shown again; the log has no body and no address, only a status, a count, a closed result word and a closed error word.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/connectors/crm`;
};
const TYPE = /^[a-z0-9_]{2,30}$/;
const typePath = (tenantId: string, type: string, tail = ""): string => {
  if (!TYPE.test(type)) throw new ApiContractError("connector type");
  return `${base(tenantId)}/${type}${tail}`;
};

export const STATES = ["connected", "not_connected", "needs_setup"] as const;
export const ERROR_WORDS = ["auth", "rejected", "not_found", "rate_limited", "server", "bad_answer", "timeout", "refused", "tls", "redirect", "blocked", "dns", "too_large", "no_secret", "config"] as const;
export type ErrorWord = (typeof ERROR_WORDS)[number];
export const RESULT_WORDS = ["created", "updated", "noted", "appended", "skipped"] as const;
export const DELIVERY_STATUS = ["pending", "retrying", "delivered", "skipped", "dead"] as const;

export type Field = { key: string; label: string; help: string; example: string };
export type LastTest = { at: string; ok: boolean; reason: ErrorWord | null };
export type Connection = { id: string; config: Record<string, string>; mapping: Record<string, string>; events: string[]; active: boolean; failing: boolean; deadLetters7d: number; lastDeliveredAt: string | null; lastTest: LastTest | null };
export type Card = {
  type: string;
  label: string;
  state: (typeof STATES)[number];
  needsSetup: string | null;
  credentials: Field[];
  settings: Field[];
  targets: { field: string; label: string }[];
  ourFields: { key: string; label: string }[];
  defaultMapping: Record<string, string>;
  usesNotes: boolean;
  noteValue: string;
  setupSteps: string[];
  script: string | null;
  connection: Connection | null;
};
export type ConnectorsPage = { items: Card[]; events: string[]; available: boolean };

const strMap = (v: unknown, what: string, max = 40): Record<string, string> => {
  const r = rec(v ?? {}, what);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(r)) {
    if (Object.keys(out).length >= max) throw new ApiContractError(what);
    out[str(k, what, 60)] = str(val, what, 300);
  }
  return out;
};
const field = (v: unknown): Field => {
  const r = rec(v, "field");
  return { key: str(r.key, "key", 40), label: str(r.label, "label", 120), help: str(r.help ?? "", "help", 400), example: str(r.example ?? "", "example", 200) };
};
const errorWord = (v: unknown): ErrorWord | null => ((ERROR_WORDS as readonly string[]).includes(v as string) ? (v as ErrorWord) : null);

export function parseConnection(json: unknown): Connection {
  const x = rec(json, "connection");
  const h = rec(x.health ?? {}, "health");
  const t = x.last_test === null || x.last_test === undefined ? null : rec(x.last_test, "last_test");
  return {
    id: uuid(x.id, "id"),
    config: strMap(x.config, "config"),
    mapping: strMap(x.mapping, "mapping"),
    events: readRows(x.events, "events", (e) => str(e, "event", 40), 10),
    active: bool(x.active, "active"),
    failing: h.status === "failing",
    deadLetters7d: optInt(h.dead_letters_7d, "dead_letters_7d", 0, 1_000_000) ?? 0,
    lastDeliveredAt: optIso(h.last_delivered_at, "last_delivered_at"),
    lastTest: t ? { at: iso(t.at, "at"), ok: bool(t.ok, "ok"), reason: errorWord(t.reason) } : null,
  };
}

export function parseCard(json: unknown): Card {
  const x = rec(json, "card");
  const state = (STATES as readonly string[]).includes(x.state as string) ? (x.state as Card["state"]) : null;
  if (!state) throw new ApiContractError("state");
  return {
    type: str(x.type, "type", 30),
    label: str(x.label, "label", 60),
    state,
    needsSetup: optStr(x.needs_setup, "needs_setup", 400),
    credentials: readRows(x.credentials, "credentials", field, 6),
    settings: readRows(x.settings, "settings", field, 6),
    targets: readRows(x.targets, "targets", (r) => ({ field: str(rec(r, "target").field, "field", 60), label: str(rec(r, "target").label, "label", 80) }), 40),
    ourFields: readRows(x.our_fields, "our_fields", (r) => ({ key: str(rec(r, "ours").key, "key", 20), label: str(rec(r, "ours").label, "label", 120) }), 20),
    defaultMapping: strMap(x.default_mapping, "default_mapping"),
    usesNotes: bool(x.uses_notes, "uses_notes"),
    noteValue: str(x.note_value, "note_value", 20),
    setupSteps: readRows(x.setup_steps, "setup_steps", (s) => str(s, "step", 400), 10),
    script: optStr(x.script, "script", 20_000),
    connection: x.connection === null || x.connection === undefined ? null : parseConnection(x.connection),
  };
}

export function parsePage(json: unknown): ConnectorsPage {
  const x = rec(json, "connectors");
  return {
    items: readRows(x.items, "items", parseCard, 30),
    events: readRows(x.events, "events", (e) => str(rec(e, "event").event, "event", 40), 10),
    available: x.available === true,
  };
}

export type Delivery = { id: string; event: string; status: (typeof DELIVERY_STATUS)[number]; attempts: number; code: number | null; result: (typeof RESULT_WORDS)[number] | null; error: ErrorWord | null; createdAt: string };
export type Deliveries = { items: Delivery[]; nextBefore: string | null };
export function parseDeliveries(json: unknown): Deliveries {
  const x = rec(json, "deliveries");
  return {
    items: readRows(x.items, "items", (r) => {
      const d = rec(r, "delivery");
      const status = (DELIVERY_STATUS as readonly string[]).includes(d.status as string) ? (d.status as Delivery["status"]) : null;
      if (!status) throw new ApiContractError("status");
      const result = (RESULT_WORDS as readonly string[]).includes(d.result as string) ? (d.result as Delivery["result"]) : null;
      return { id: uuid(d.id, "id"), event: str(d.event, "event", 40), status, attempts: int(d.attempts, "attempts", 0, 100), code: optInt(d.last_status_code, "code", 100, 599), result, error: errorWord(d.last_error), createdAt: iso(d.created_at, "created_at") };
    }, 100),
    nextBefore: optStr(x.next_before, "next_before", 200),
  };
}

export type Fail = { ok: false; error: "mfa" | "forbidden" | "unavailable" | "needs_setup" | "credentials" | "settings" | "mapping" | "other"; reason?: ErrorWord };
export function failOf(error: unknown): Fail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return { ok: false, error: "mfa" };
    if (error.code === "crm_push_unavailable") return { ok: false, error: "unavailable" };
    if (error.code === "needs_setup_by_us") return { ok: false, error: "needs_setup" };
    if (error.code === "credentials_invalid") return { ok: false, error: "credentials" };
    if (error.code === "settings_invalid") return { ok: false, error: "settings", ...(errorWord(error.reason) ? { reason: errorWord(error.reason) as ErrorWord } : {}) };
    if (error.code === "mapping_invalid") return { ok: false, error: "mapping" };
    if (error.status === 403) return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "other" };
}

const send = (path: string, token: string, method: string, body?: unknown): Promise<unknown> => apiRequest(path, token, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const getPage = async (token: string, t: string): Promise<ConnectorsPage> => parsePage(await apiRequest(base(t), token));
export type ConnectInput = { credentials: Record<string, string>; settings: Record<string, string>; mapping?: Record<string, string>; events?: string[] };
export const connect = async (token: string, t: string, type: string, i: ConnectInput): Promise<Connection> => parseConnection(rec(await send(typePath(t, type), token, "PUT", i), "connected").connection);
export type ChangeInput = { mapping?: Record<string, string>; events?: string[]; active?: boolean };
export const change = async (token: string, t: string, type: string, i: ChangeInput): Promise<Connection> => parseConnection(rec(await send(typePath(t, type), token, "PATCH", i), "changed").connection);
export const disconnect = async (token: string, t: string, type: string): Promise<void> => {
  await send(typePath(t, type), token, "DELETE");
};
export type TestResult = { ok: boolean; reason: ErrorWord | null };
export const testConnection = async (token: string, t: string, type: string): Promise<TestResult> => {
  const x = rec(await send(typePath(t, type, "/test"), token, "POST", {}), "test");
  return { ok: bool(x.ok, "ok"), reason: errorWord(x.reason) };
};
export const listDeliveries = async (token: string, t: string, type: string, before: string | null): Promise<Deliveries> => parseDeliveries(await apiRequest(`${typePath(t, type, "/deliveries")}${before ? `?before=${encodeURIComponent(before)}` : ""}`, token));
export const retryDead = async (token: string, t: string, type: string): Promise<number> => int(rec(await send(typePath(t, type, "/retry"), token, "POST", {}), "retry").requeued, "requeued", 0, 100_000);
