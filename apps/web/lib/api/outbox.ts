import { ApiContractError, apiRequest } from "./client";
import { pictureUrl } from "./catalogue";
import { isCanonicalUuid } from "./crm";

/**
 * The outbox and the call requests (job AT, ADR 0066), as Today needs them. Server side only, with the signed-in user's own token. The field names are the contract's, exactly (snake_case).
 * Every outgoing WhatsApp message is a row here; the database decides, deterministically, whether it goes by itself or waits for a person. This file reads the log and the waiting queue, and
 * sends the person's decision (edit, approve, reject; approve a call: a call is declined only by offering a visit instead). It sends nothing itself and never holds a phone number: the API does not give one.
 *
 * Who may do what (the API decides; the screen only hides what it would refuse): the log and a single message: Owner, Admin, Sales. The waiting queue, edit, approve (needs the second factor) and
 * reject: Owner and Admin. A call request is read by Owner, Admin and Sales; approving or declining it is the Owner's, with the second factor. A Viewer gets 403 on all of it.
 * A response that does not match the contract is an error and nothing is shown.
 */
export const OUTBOX_LANGUAGES = ["en", "te", "hi", "kn", "ta"] as const;
export type OutboxLanguage = (typeof OUTBOX_LANGUAGES)[number];
export const OUTBOX_CATEGORIES = ["reply_to_inbound", "info", "visit", "followup", "order_status", "other"] as const;
export type OutboxCategory = (typeof OUTBOX_CATEGORIES)[number];
export const OUTBOX_STATUSES = ["queued", "needs_approval", "sent", "blocked", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
export const OUTBOX_FLAGS = ["money", "commitment", "complaint"] as const;
export type OutboxFlag = (typeof OUTBOX_FLAGS)[number];
/** `system` = made by a fixed template of the shop itself (a visit confirmation, a reminder, an offered visit), job AS. */
export const OUTBOX_SOURCES = ["owner", "assistant", "system"] as const;
export type OutboxSource = (typeof OUTBOX_SOURCES)[number];
/** The closed set of reasons a message is in the state it is in (fixed English `reason_text` comes with it). */
export const OUTBOX_REASONS = [
  "auto_allowed", "quiet_hours", "owner_approved", "money", "commitment", "complaint", "model_flagged", "uncertain", "category_other", "no_inbound_window", "auto_off", "switch_off",
  "no_contact", "no_phone", "stopped", "erased", "no_opt_in", "no_key", "daily_limit", "owner_rejected", "send_failed",
] as const;
export type OutboxReason = (typeof OUTBOX_REASONS)[number];
export const CALL_STATUSES = ["requested", "approved", "rejected"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export interface OutboxMessage {
  id: string;
  lead_id: string;
  customer: string | null;
  city: string | null;
  channel: "whatsapp";
  /** The exact words that go to the customer (with the AI-assistant line when it is the first message). Never shown anywhere but to a person who may decide it. */
  text: string;
  language: OutboxLanguage;
  category: OutboxCategory;
  source: OutboxSource;
  status: OutboxStatus;
  reason: OutboxReason;
  /** The API's fixed English sentence for `reason`. */
  reason_text: string;
  flags: OutboxFlag[];
  model_flagged: boolean;
  uncertain: boolean;
  disclosure_added: boolean;
  scheduled_for: string | null;
  created_at: string;
  edited_at: string | null;
  decided_at: string | null;
  sent_at: string | null;
  failure_code: "adapter_error" | "timeout" | "rejected" | null;
  /** The photos the message carries (catalogue sends, job AY), in order; empty for a text message and for an API from before photos. `thumb_url` is a signed link that runs out in ten minutes, or null if it could not be signed. */
  media: OutboxMedia[];
  /** An English gloss of the words (job BB): what a person who does not read the message's language can read; null when none was written. Personal data like the words. */
  gloss_en: string | null;
  /** The real history of the message, oldest first (job BB): only in the answer for ONE message (`GET /outbox/messages/{id}`); null in a list. */
  events: OutboxEvent[] | null;
}

export const OUTBOX_EVENT_KINDS = ["made", "queued", "held", "needs_approval", "approved", "rejected", "edited", "blocked", "sent", "failed"] as const;
export type OutboxEventKind = (typeof OUTBOX_EVENT_KINDS)[number];
export const OUTBOX_ACTOR_KINDS = ["person", "assistant", "worker", "system"] as const;
export type OutboxActorKind = (typeof OUTBOX_ACTOR_KINDS)[number];

/** One step of a message's life. `reason_text` is the API's fixed English sentence for `reason`. An event carries no words of the message. `actor.name` is null for the worker, the system or someone who is no longer a co-member. */
export interface OutboxEvent {
  kind: OutboxEventKind;
  reason: string | null;
  reason_text: string | null;
  at: string;
  actor: { kind: OutboxActorKind; user_id: string | null; name: string | null };
}

export interface OutboxMedia {
  photo_id: string;
  position: number;
  thumb_url: string | null;
}

export interface CallRequest {
  id: string;
  lead_id: string;
  customer: string | null;
  city: string | null;
  reason: string;
  script_draft: string;
  language: OutboxLanguage;
  status: CallStatus;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

export interface OutboxPage {
  items: OutboxMessage[];
  next_cursor: string | null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an outbox response.`);
}
const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : bad(what));
const uuid = (v: unknown, what: string): string => (typeof v === "string" && isCanonicalUuid(v) ? v : bad(what));
const str = (v: unknown, what: string, max: number): string => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : bad(what));
const nullableStr = (v: unknown, what: string, max: number): string | null => (v === null ? null : typeof v === "string" && v.length <= max ? v : bad(what));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
function when(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}
const nullableWhen = (v: unknown, what: string): string | null => (v === null ? null : when(v, what));

const MAX_MEDIA = 4;
function parseMedia(v: unknown): OutboxMedia[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_MEDIA) return bad("media");
  return v.map((m): OutboxMedia => {
    if (!isRecord(m) || !Number.isInteger(m.position) || (m.position as number) < 1 || (m.position as number) > MAX_MEDIA) return bad("media item");
    return { photo_id: uuid(m.photo_id, "photo_id"), position: m.position as number, thumb_url: pictureUrl(m.thumb_url ?? null, "thumb_url") };
  });
}

function parseEvents(v: unknown): OutboxEvent[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 200) return bad("events");
  return v.map((e): OutboxEvent => {
    if (!isRecord(e) || !isRecord(e.actor)) return bad("event");
    return {
      kind: oneOf(OUTBOX_EVENT_KINDS, e.kind, "event kind"),
      reason: e.reason === null || e.reason === undefined ? null : str(e.reason, "event reason", 60),
      reason_text: e.reason_text === null || e.reason_text === undefined ? null : str(e.reason_text, "event reason_text", 400),
      at: when(e.at, "event at"),
      actor: {
        kind: oneOf(OUTBOX_ACTOR_KINDS, e.actor.kind, "actor kind"),
        user_id: e.actor.user_id === null || e.actor.user_id === undefined ? null : uuid(e.actor.user_id, "actor user_id"),
        name: e.actor.name === null || e.actor.name === undefined ? null : str(e.actor.name, "actor name", 200),
      },
    };
  });
}

export function parseOutboxMessage(json: unknown): OutboxMessage {
  if (!isRecord(json)) return bad("message");
  if (json.channel !== "whatsapp") return bad("channel");
  if (!Array.isArray(json.flags) || json.flags.length > 3) return bad("flags");
  const failure = json.failure_code;
  return {
    id: uuid(json.id, "id"),
    lead_id: uuid(json.lead_id, "lead_id"),
    customer: nullableStr(json.customer, "customer", 200),
    city: nullableStr(json.city, "city", 200),
    channel: "whatsapp",
    text: str(json.text, "text", 3200),
    language: oneOf(OUTBOX_LANGUAGES, json.language, "language"),
    category: oneOf(OUTBOX_CATEGORIES, json.category, "category"),
    source: oneOf(OUTBOX_SOURCES, json.source, "source"),
    status: oneOf(OUTBOX_STATUSES, json.status, "status"),
    reason: oneOf(OUTBOX_REASONS, json.reason, "reason"),
    reason_text: str(json.reason_text, "reason_text", 400),
    flags: json.flags.map((f) => oneOf(OUTBOX_FLAGS, f, "flag")),
    model_flagged: bool(json.model_flagged, "model_flagged"),
    uncertain: bool(json.uncertain, "uncertain"),
    disclosure_added: bool(json.disclosure_added, "disclosure_added"),
    scheduled_for: nullableWhen(json.scheduled_for, "scheduled_for"),
    created_at: when(json.created_at, "created_at"),
    edited_at: nullableWhen(json.edited_at, "edited_at"),
    decided_at: nullableWhen(json.decided_at, "decided_at"),
    sent_at: nullableWhen(json.sent_at, "sent_at"),
    failure_code: failure === null ? null : oneOf(["adapter_error", "timeout", "rejected"] as const, failure, "failure_code"),
    media: parseMedia(json.media),
    // an API from before job BB has neither: no gloss and no events
    gloss_en: json.gloss_en === null || json.gloss_en === undefined ? null : str(json.gloss_en, "gloss_en", 3200),
    events: parseEvents(json.events),
  };
}

export function parseOutboxPage(json: unknown): OutboxPage {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 100) return bad("page");
  const cursor = json.next_cursor;
  if (cursor !== null && (typeof cursor !== "string" || cursor === "" || cursor.length > 400)) return bad("next_cursor");
  return { items: json.items.map(parseOutboxMessage), next_cursor: cursor };
}

export function parseCallRequest(json: unknown): CallRequest {
  if (!isRecord(json)) return bad("call request");
  return {
    id: uuid(json.id, "id"),
    lead_id: uuid(json.lead_id, "lead_id"),
    customer: nullableStr(json.customer, "customer", 200),
    city: nullableStr(json.city, "city", 200),
    reason: str(json.reason, "reason", 600),
    script_draft: str(json.script_draft, "script_draft", 4200),
    language: oneOf(OUTBOX_LANGUAGES, json.language, "language"),
    status: oneOf(CALL_STATUSES, json.status, "status"),
    created_at: when(json.created_at, "created_at"),
    decided_at: nullableWhen(json.decided_at, "decided_at"),
    decision_note: nullableStr(json.decision_note, "decision_note", 600),
  };
}

export function parseCallRequestPage(json: unknown): { items: CallRequest[]; next_cursor: string | null } {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 100) return bad("call request page");
  const cursor = json.next_cursor;
  if (cursor !== null && (typeof cursor !== "string" || cursor === "" || cursor.length > 400)) return bad("next_cursor");
  return { items: json.items.map(parseCallRequest), next_cursor: cursor };
}

/** The answer of approve and reject: the message as it now is, and (approve, Owner or Admin) how many due messages were handed to the channel at once. */
export interface OutboxDecision {
  message: OutboxMessage;
  dispatched: { sent: number; failed: number } | null;
}

export function parseOutboxDecision(json: unknown): OutboxDecision {
  if (!isRecord(json)) return bad("decision");
  let dispatched: OutboxDecision["dispatched"] = null;
  if (json.dispatched !== null && json.dispatched !== undefined) {
    const d = json.dispatched;
    if (!isRecord(d) || !Number.isSafeInteger(d.sent) || !Number.isSafeInteger(d.failed)) return bad("dispatched");
    dispatched = { sent: d.sent as number, failed: d.failed as number };
  }
  return { message: parseOutboxMessage(json.message), dispatched };
}

const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idPath = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const post = (path: string, accessToken: string, body?: unknown) => apiRequest(path, accessToken, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** The four tabs of the log, as the API names them (`GET /outbox/messages?tab=`): waiting = needs approval, scheduled = queued, sent, blocked = blocked and failed. */
export const OUTBOX_TABS = ["waiting", "scheduled", "sent", "blocked"] as const;
export type OutboxTabName = (typeof OUTBOX_TABS)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters of the log (job BB): done by the server, with a cursor that keeps them. `customer` is a part of a company's or contact's NAME (never the words of a message); `from` and `to` are India dates, both included. Not combined with `status`. */
export interface OutboxFilters {
  tab?: OutboxTabName;
  customer?: string;
  from?: string;
  to?: string;
}

function filterQuery(q: URLSearchParams, f: OutboxFilters): void {
  if (f.tab) q.set("tab", f.tab);
  if (f.customer && f.customer.trim() !== "") q.set("customer", f.customer.trim().slice(0, 100));
  if (f.from) {
    if (!DAY.test(f.from)) throw new ApiContractError("date");
    q.set("from", f.from);
  }
  if (f.to) {
    if (!DAY.test(f.to)) throw new ApiContractError("date");
    q.set("to", f.to);
  }
}

/** `GET /outbox/messages`: the log, newest first. Owner, Admin, Sales. `limit` 1 to 100. Either `status` (one state) or the server filters (`tab`, `customer`, `from`, `to`), never both. */
export async function listOutboxMessages(accessToken: string, tenantId: string, opts: ({ limit?: number; after?: string | null; status?: OutboxStatus } & OutboxFilters) = {}): Promise<OutboxPage> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 30) });
  if (opts.after) q.set("after", opts.after);
  if (opts.status) q.set("status", opts.status);
  filterQuery(q, opts);
  return parseOutboxPage(await apiRequest(tenantPath(tenantId, `outbox/messages?${q.toString()}`), accessToken));
}

/** `GET /outbox/messages/{id}`: one message with its real history (`events`). Owner, Admin, Sales. */
export async function getOutboxMessage(accessToken: string, tenantId: string, id: string): Promise<OutboxMessage> {
  return parseOutboxMessage(await apiRequest(tenantPath(tenantId, `outbox/messages/${idPath(id)}`), accessToken));
}

/** The counts behind the tabs, with the same `customer` and `from` / `to` filters as the log, and what Dispatch would act on: `due_now` (due and may go) and `held_for_later` (scheduled for the morning); those two are never filtered. */
export interface OutboxSummary {
  waiting: number;
  scheduled: number;
  sent: number;
  blocked: number;
  due_now: number;
  held_for_later: number;
}

export function parseOutboxSummary(json: unknown): OutboxSummary {
  if (!isRecord(json)) return bad("summary");
  const n = (v: unknown, what: string): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000 ? v : bad(what));
  return { waiting: n(json.waiting, "waiting"), scheduled: n(json.scheduled, "scheduled"), sent: n(json.sent, "sent"), blocked: n(json.blocked, "blocked"), due_now: n(json.due_now, "due_now"), held_for_later: n(json.held_for_later, "held_for_later") };
}

/** `GET /outbox/summary`: the counts per tab. Owner, Admin, Sales. */
export async function getOutboxSummary(accessToken: string, tenantId: string, f: Omit<OutboxFilters, "tab"> = {}): Promise<OutboxSummary> {
  const q = new URLSearchParams();
  filterQuery(q, f);
  const s = q.toString();
  return parseOutboxSummary(await apiRequest(tenantPath(tenantId, `outbox/summary${s ? `?${s}` : ""}`), accessToken));
}

/** `GET /outbox/approvals`: the messages waiting for a person, newest first. Owner and Admin. */
export async function listOutboxApprovals(accessToken: string, tenantId: string, opts: { limit?: number } = {}): Promise<OutboxPage> {
  return parseOutboxPage(await apiRequest(tenantPath(tenantId, `outbox/approvals?limit=${opts.limit ?? 30}`), accessToken));
}

/** `POST /outbox/messages/{id}/edit`: new words for a message that is still waiting (the AI-assistant line stays). Owner and Admin. */
export async function editOutboxMessage(accessToken: string, tenantId: string, id: string, text: string): Promise<OutboxMessage> {
  return parseOutboxMessage(await post(tenantPath(tenantId, `outbox/messages/${idPath(id)}/edit`), accessToken, { text }));
}

/** `POST /outbox/messages/{id}/approve`: Owner or Admin, with the second factor. The message becomes queued, sent or (if the customer stopped meanwhile) blocked. */
export async function approveOutboxMessage(accessToken: string, tenantId: string, id: string): Promise<OutboxDecision> {
  return parseOutboxDecision(await post(tenantPath(tenantId, `outbox/messages/${idPath(id)}/approve`), accessToken));
}

/** `POST /outbox/messages/{id}/reject`: Owner and Admin. The message is blocked (`owner_rejected`) and never sent. */
export async function rejectOutboxMessage(accessToken: string, tenantId: string, id: string): Promise<OutboxDecision> {
  return parseOutboxDecision(await post(tenantPath(tenantId, `outbox/messages/${idPath(id)}/reject`), accessToken));
}

/** `GET /call-requests`: Owner, Admin, Sales. */
export async function listCallRequests(accessToken: string, tenantId: string, opts: { status?: CallStatus; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 30) });
  if (opts.status) q.set("status", opts.status);
  return parseCallRequestPage(await apiRequest(tenantPath(tenantId, `call-requests?${q.toString()}`), accessToken));
}

/** `POST /call-requests/{id}/approve`: the Owner only, with the second factor. Nothing dials; the request is recorded as approved. */
export async function approveCallRequest(accessToken: string, tenantId: string, id: string, note?: string): Promise<CallRequest> {
  return parseCallRequest(await post(tenantPath(tenantId, `call-requests/${idPath(id)}/approve`), accessToken, note ? { note } : {}));
}


/** `POST /outbox/messages`: one WhatsApp message to the lead's contact, with the words the person wrote. The same `messageId` is a retry and replays. The policy decides: it goes (Owner/Admin hand it to the channel at once), waits for 9:00, waits for a person, or is blocked. Owner, Admin, Sales. */
export async function submitOutboxMessage(
  accessToken: string,
  tenantId: string,
  input: { messageId: string; leadId: string; text: string; language: OutboxLanguage; category: OutboxCategory; photoIds?: readonly string[]; keepRecord?: boolean },
): Promise<{ message: OutboxMessage; replayed: boolean }> {
  const json = await post(tenantPath(tenantId, "outbox/messages"), accessToken, {
    message_id: idPath(input.messageId),
    lead_id: idPath(input.leadId),
    text: input.text,
    language: input.language,
    category: input.category,
    source: "owner",
    // photos (up to four catalogue photos, job AY) and the record flag are sent only when used, so a plain text message is the request it always was
    ...(input.photoIds && input.photoIds.length > 0 ? { photo_ids: input.photoIds.map(idPath) } : {}),
    ...(input.keepRecord ? { keep_record: true } : {}),
  });
  if (!isRecord(json)) return bad("submit result");
  return { message: parseOutboxMessage(json.message), replayed: json.replayed === true };
}

/** `POST /call-requests`: ask to phone the lead's contact. Only a request until the Owner approves it; nothing dials. Owner, Admin, Sales. */
export async function createCallRequest(
  accessToken: string,
  tenantId: string,
  input: { requestId: string; leadId: string; reason: string; scriptDraft: string; language: OutboxLanguage },
): Promise<{ request: CallRequest; replayed: boolean }> {
  const json = await post(tenantPath(tenantId, "call-requests"), accessToken, {
    request_id: idPath(input.requestId),
    lead_id: idPath(input.leadId),
    reason: input.reason,
    script_draft: input.scriptDraft,
    language: input.language,
  });
  if (!isRecord(json)) return bad("call request result");
  return { request: parseCallRequest(json.request), replayed: json.replayed === true };
}

/** The business's sending settings (`GET /outbox/settings`, Owner and Admin): the system-wide switch (the operator's, read only here), this business's automatic sending, the per-customer daily limit and the quiet hours (job BB). */
export interface OutboxSettings {
  platform_switch_on: boolean;
  auto_send_enabled: boolean;
  per_customer_daily_limit: number;
  /** The hour (India time) from which no message is sent, 19 to 23. */
  quiet_hours_start: number;
  /** The hour (India time) from which messages may go again, 7 to 10. */
  quiet_hours_end: number;
}
/** The limits of the quiet hours the API accepts. */
export const QUIET_START = { min: 19, max: 23 } as const;
export const QUIET_END = { min: 7, max: 10 } as const;
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;

export function parseOutboxSettings(json: unknown): OutboxSettings {
  if (!isRecord(json)) return bad("settings");
  const limit = json.per_customer_daily_limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) return bad("per_customer_daily_limit");
  // an API from before job BB has no quiet hours of its own: the fixed 21:00 to 09:00 it always used
  const start = json.quiet_hours_start === undefined ? 21 : json.quiet_hours_start;
  const end = json.quiet_hours_end === undefined ? 9 : json.quiet_hours_end;
  if (!inRange(start, QUIET_START)) return bad("quiet_hours_start");
  if (!inRange(end, QUIET_END)) return bad("quiet_hours_end");
  return { platform_switch_on: bool(json.platform_switch_on, "platform_switch_on"), auto_send_enabled: bool(json.auto_send_enabled, "auto_send_enabled"), per_customer_daily_limit: limit, quiet_hours_start: start, quiet_hours_end: end };
}

export async function getOutboxSettings(accessToken: string, tenantId: string): Promise<OutboxSettings> {
  return parseOutboxSettings(await apiRequest(tenantPath(tenantId, "outbox/settings"), accessToken));
}

/** `PUT /outbox/settings`: the Owner only, with the second factor. Automatic sending is off until the Owner turns it on. A quiet hour left out keeps its value (the API's rule). */
export async function putOutboxSettings(accessToken: string, tenantId: string, input: { auto_send_enabled: boolean; per_customer_daily_limit: number; quiet_hours_start?: number; quiet_hours_end?: number }): Promise<OutboxSettings> {
  const body: Record<string, unknown> = { auto_send_enabled: input.auto_send_enabled, per_customer_daily_limit: input.per_customer_daily_limit };
  if (input.quiet_hours_start !== undefined) body.quiet_hours_start = input.quiet_hours_start;
  if (input.quiet_hours_end !== undefined) body.quiet_hours_end = input.quiet_hours_end;
  return parseOutboxSettings(await apiRequest(tenantPath(tenantId, "outbox/settings"), accessToken, { method: "PUT", body: JSON.stringify(body) }));
}

/** What "Send what is due now" did (job BB): how many went and failed, how many will be tried again shortly (`retry_later`: a photo link could not be made), how many are still due but were not handed over (blocked at the last check), how many are held for the morning, and whether the system-wide switch is on. */
export interface DispatchResult {
  sent: number;
  failed: number;
  retry_later: number;
  still_due: number;
  held_for_later: number;
  /** null from an API that does not say. */
  platform_switch_on: boolean | null;
}

/** `POST /outbox/dispatch`: hand what is due to the channel now, for THIS business. Owner and Admin. */
export async function dispatchOutbox(accessToken: string, tenantId: string): Promise<DispatchResult> {
  const json = await post(tenantPath(tenantId, "outbox/dispatch"), accessToken);
  const n = (v: unknown, def: number | null): number => (v === undefined || v === null ? (def ?? bad("dispatch")) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad("dispatch"));
  if (!isRecord(json)) return bad("dispatch");
  const sw = json.platform_switch_on;
  if (sw !== undefined && sw !== null && typeof sw !== "boolean") return bad("platform_switch_on");
  return { sent: n(json.sent, null), failed: n(json.failed, null), retry_later: n(json.retry_later, 0), still_due: n(json.still_due, 0), held_for_later: n(json.held_for_later, 0), platform_switch_on: typeof sw === "boolean" ? sw : null };
}
