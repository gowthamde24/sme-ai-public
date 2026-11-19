import { readJar, writeJar } from "@/lib/mock/jar";
import { chatQueueScreens } from "@/lib/screens/flag";

import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, iso, oneOf, optIso, rec, str, uuid, word } from "./shape";

/**
 * The Chats composer queue (owner, 19 Nov 2026; C1's contract: contracts/composer-queue-DRAFT.md). ONE adapter file: the paths, every PARSER of the wire shape (closed words through lib/api/shape.ts), the refusals and the `mock`, so a change of the contract is an edit here and nowhere else.
 *
 *   POST `/v1/tenants/{t}/conversations/{lead}/queued-message` `{text 1..1000, client_id uuid}` -> `{id, status, send_at, queued_at, expires_at, text, continue_chat, failure_code}`  (only when the 24 h window is CLOSED; an open window sends normally)
 *   GET  the same path -> `{queued: null | {...}}` (the newest one that is open or ended in the last 7 days)
 *   POST `.../queued-message/{id}/cancel` -> `{id, status: "cancelled"}`   (no HTTP DELETE)
 *
 * Status (closed): waiting_for_reply | sending | sent | cancelled | expired | failed. `replied_waiting_for_morning` is the old night state (dropped 19 Nov: an answer to a customer who wrote first goes AT ONCE, day or night); the parser still accepts it, and any word it does not know, as `sending`
 * ("Sending…"), so a change on the API side never breaks the screen. `cancelled` with `failure_code: "stopped_by_customer"` is a STOP. SERVER ONLY (the browser gets the parsed values through server actions).
 * `CHAT_QUEUE_SCREENS`: unset = the old screen, `mock` = the cookie below (nothing is sent), `1` = the routes.
 */
export const QUEUE_TEXT_MAX = 1000;
export const QUEUE_STATUSES = ["waiting_for_reply", "sending", "sent", "cancelled", "expired", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const CONTINUE_CHAT = ["sent", "pending", "already", "not_approved"] as const;
export type ContinueChat = (typeof CONTINUE_CHAT)[number];

export type QueuedMessage = {
  id: string;
  text: string;
  status: QueueStatus;
  /** the time the message is due (ISO), when the API knows it; null while it waits for the reply */
  sendAt: string | null;
  queuedAt: string;
  /** the moment it is given up (7 days after it was queued) */
  expiresAt: string | null;
  continueChat: ContinueChat | null;
  /** the outbox's closed word for a `failed`, `stopped_by_customer` for a STOP */
  failureCode: string | null;
};

/** The refusals, one closed list: what the screen has a sentence for. `already_queued` and `window_open` are not errors (the screen shows the one that is there, or sends normally). */
export const QUEUE_REFUSALS = ["stopped_by_customer", "consent_required", "window_open", "no_whatsapp", "daily_limit", "forbidden", "text_invalid", "already_queued", "not_waiting", "not_available", "down"] as const;
export type QueueRefusal = (typeof QUEUE_REFUSALS)[number];
export type QueueResult<T> = { ok: true; data: T } | { ok: false; refusal: QueueRefusal };

/* ---- the wire shape ---- */
function parseStatus(v: unknown): QueueStatus {
  const w = typeof v === "string" ? v : "";
  return (QUEUE_STATUSES as readonly string[]).includes(w) ? (w as QueueStatus) : "sending"; // replied_waiting_for_morning and anything unknown: "Sending…"
}
export function parseQueuedMessage(json: unknown): QueuedMessage {
  const x = rec(json, "queued message");
  const cc = x.continue_chat;
  const text = str(x.text, "queued text", QUEUE_TEXT_MAX + 200);
  return {
    id: uuid(x.id, "queued id"),
    text,
    status: parseStatus(x.status),
    sendAt: optIso(x.send_at, "send_at"),
    queuedAt: iso(x.queued_at, "queued_at"),
    expiresAt: optIso(x.expires_at, "expires_at"),
    continueChat: cc === null || cc === undefined ? null : oneOf(cc, CONTINUE_CHAT, "continue_chat"),
    failureCode: x.failure_code === null || x.failure_code === undefined ? null : word(x.failure_code, "failure_code"),
  };
}
/** `GET`: `{queued: null | {...}}`. */
export function parseQueuedRead(json: unknown): QueuedMessage | null {
  const x = rec(json, "queued message read");
  return x.queued === null || x.queued === undefined ? null : parseQueuedMessage(x.queued);
}
/** `POST .../cancel`: `{id, status: "cancelled"}`. */
export function parseCancelled(json: unknown): { id: string; status: "cancelled" } {
  const x = rec(json, "cancel");
  if (x.status !== "cancelled") bad("cancel status");
  return { id: uuid(x.id, "cancel id"), status: "cancelled" };
}
/** The closed word of a refusal (`error.code`, else the status), as the screen's list; nothing the API writes is ever shown. */
export function refusalOf(error: unknown): QueueRefusal {
  if (error instanceof ApiRequestError) {
    if ((QUEUE_REFUSALS as readonly string[]).includes(error.code)) return error.code as QueueRefusal;
    if (error.status === 429) return "daily_limit";
    if (error.status === 403) return "forbidden";
    if (error.status === 404 || error.status === 405) return "not_available";
    if (error.status === 422) return "text_invalid";
  }
  return "down";
}

/* ---- the calls ---- */
const path = (tenantId: string, leadId: string): string => {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) throw new ApiContractError("Unexpected id.");
  return `/v1/tenants/${tenantId}/conversations/${leadId}/queued-message`;
};

/** The queued message of a chat: undefined = the part is off or the API does not have it (the screen keeps the old composer), null = none. A read that fails (the network, a 5xx) THROWS: the page counts it as none, the 5-second poll keeps what it shows. */
export async function readQueued(token: string, tenantId: string, leadId: string, now: number = Date.now()): Promise<QueuedMessage | null | undefined> {
  const mode = chatQueueScreens();
  if (mode === "off") return undefined;
  if (mode === "mock") return mockRead(leadId, now);
  try {
    return parseQueuedRead(await apiRequest(path(tenantId, leadId), token));
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 405)) return undefined;
    throw error;
  }
}

/** Queue a message (the window is closed). One per chat: a second is `already_queued`. */
export async function queueMessage(token: string, tenantId: string, leadId: string, input: { text: string; clientId: string }, now: number = Date.now()): Promise<QueueResult<QueuedMessage>> {
  const mode = chatQueueScreens();
  if (mode === "off") return { ok: false, refusal: "not_available" };
  const text = input.text.trim();
  if (text.length < 1 || text.length > QUEUE_TEXT_MAX || !isCanonicalUuid(input.clientId)) return { ok: false, refusal: "text_invalid" };
  if (mode === "mock") return mockQueue(leadId, text, input.clientId, now);
  try {
    return { ok: true, data: parseQueuedMessage(await apiRequest(path(tenantId, leadId), token, { method: "POST", body: JSON.stringify({ text, client_id: input.clientId }) })) };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/** Cancel the one that waits. `not_waiting` = it already went. */
export async function cancelQueued(token: string, tenantId: string, leadId: string, id: string, now: number = Date.now()): Promise<QueueResult<{ id: string; status: "cancelled" }>> {
  const mode = chatQueueScreens();
  if (mode === "off") return { ok: false, refusal: "not_available" };
  if (!isCanonicalUuid(id)) return { ok: false, refusal: "text_invalid" };
  if (mode === "mock") return mockCancel(leadId, id, now);
  try {
    return { ok: true, data: parseCancelled(await apiRequest(`${path(tenantId, leadId)}/${id}/cancel`, token, { method: "POST", body: JSON.stringify({}) })) };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/* ---- the mock (CHAT_QUEUE_SCREENS=mock): nothing leaves the server; one small cookie. The state is a pure function of the clock, so a page read never writes. ----
 * Every state is reachable by a word in the text (the owner's walk on staging): normally "waiting" for 20 s, "sending" for 6 s, then "sent".
 *   #stopped  -> after 15 s the customer said STOP (cancelled + stopped_by_customer)      #fail    -> after 15 s it fails (the retry goes through)
 *   #expire   -> after 15 s it expires (7 days without a reply)                           #hello   -> the hello is not approved (continue_chat not_approved)
 *   #stop     -> refused at once, the customer had said STOP (409)                        #consent -> refused, consent is missing (409)
 *   #limit    -> the daily limit (429)                                                    #open    -> the window opened meanwhile (409 window_open)
 */
export const MOCK_COOKIE = "sme_chat_queue_mock";
export const MOCK_REPLY_S = 20;
export const MOCK_SENDING_S = 6;
export const MOCK_FAIL_S = 15;
type MockRow = { lead: string; id: string; text: string; at: number; attempt: number; cancelledAt: number | null; script: string | null };
const REFUSE: Record<string, QueueRefusal> = { stop: "stopped_by_customer", consent: "consent_required", limit: "daily_limit", open: "window_open" };
const scriptOf = (text: string): string | null => /#(\w+)/.exec(text.toLowerCase())?.[1] ?? null;
const parseRows = (v: unknown): MockRow[] | null =>
  Array.isArray(v)
    ? v.filter((r): r is MockRow => typeof r === "object" && r !== null && typeof (r as MockRow).id === "string" && typeof (r as MockRow).lead === "string" && typeof (r as MockRow).text === "string" && typeof (r as MockRow).at === "number").slice(-3)
    : null;
const readRows = (): Promise<MockRow[]> => readJar(MOCK_COOKIE, parseRows, []);
const DAY_MS = 86_400_000;

/** The mock row as the wire would send it at `now` (exported for the tests). */
export function mockWire(r: MockRow, now: number): Record<string, unknown> {
  const age = (now - r.at) / 1000;
  const first = r.attempt <= 1;
  const normal = age >= MOCK_REPLY_S + MOCK_SENDING_S ? "sent" : age >= MOCK_REPLY_S ? "sending" : "waiting_for_reply";
  let status: string = normal;
  let failure: string | null = null;
  if (r.cancelledAt !== null) status = "cancelled";
  else if (r.script === "stopped") [status, failure] = age >= MOCK_FAIL_S ? ["cancelled", "stopped_by_customer"] : ["waiting_for_reply", null];
  else if (r.script === "fail" && first) [status, failure] = age >= MOCK_FAIL_S ? ["failed", "send_failed"] : ["waiting_for_reply", null];
  else if (r.script === "expire") status = age >= MOCK_FAIL_S ? "expired" : "waiting_for_reply";
  else if (r.script === "hello") status = "waiting_for_reply";
  return {
    id: r.id,
    text: r.text,
    status,
    send_at: status === "sending" || status === "sent" ? new Date(r.at + MOCK_REPLY_S * 1000).toISOString() : null,
    queued_at: new Date(r.at).toISOString(),
    expires_at: new Date(r.at + 7 * DAY_MS).toISOString(),
    continue_chat: r.script === "hello" ? "not_approved" : "sent",
    failure_code: failure,
  };
}
async function mockRead(leadId: string, now: number): Promise<QueuedMessage | null> {
  const r = (await readRows()).find((x) => x.lead === leadId);
  return r && now - r.at < 7 * DAY_MS ? parseQueuedMessage(mockWire(r, now)) : null;
}
async function mockQueue(leadId: string, text: string, clientId: string, now: number): Promise<QueueResult<QueuedMessage>> {
  const rows = await readRows();
  const word_ = scriptOf(text);
  if (word_ && REFUSE[word_]) return { ok: false, refusal: REFUSE[word_] };
  const mine = rows.find((x) => x.lead === leadId);
  if (mine) {
    if (mine.id === clientId) return { ok: true, data: parseQueuedMessage(mockWire(mine, now)) }; // the same client_id again = the same message
    const q = parseQueuedMessage(mockWire(mine, now));
    if (q.status === "waiting_for_reply" || q.status === "sending") return { ok: false, refusal: "already_queued" };
  }
  const row: MockRow = { lead: leadId, id: clientId, text, at: now, attempt: mine && mine.text === text ? mine.attempt + 1 : 1, cancelledAt: null, script: word_ };
  const kept = [...rows.filter((x) => x.lead !== leadId), row];
  if (!(await writeJar(MOCK_COOKIE, kept))) return { ok: false, refusal: "down" };
  return { ok: true, data: parseQueuedMessage(mockWire(row, now)) };
}
async function mockCancel(leadId: string, id: string, now: number): Promise<QueueResult<{ id: string; status: "cancelled" }>> {
  const rows = await readRows();
  const mine = rows.find((x) => x.lead === leadId && x.id === id);
  if (!mine) return { ok: false, refusal: "not_waiting" };
  if (parseQueuedMessage(mockWire(mine, now)).status !== "waiting_for_reply") return { ok: false, refusal: "not_waiting" };
  if (!(await writeJar(MOCK_COOKIE, rows.map((x) => (x === mine ? { ...x, cancelledAt: now } : x))))) return { ok: false, refusal: "down" };
  return { ok: true, data: { id, status: "cancelled" } };
}
