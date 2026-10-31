import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, oneOf, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * WhatsApp (job CC, screen 5; ADR 0076, the contract is in job BR's report): the business's number (its states), and the chat inbox (threads, a thread with how each message went). Server side only, with the person's own token.
 * A reply is the existing outbox submit (lib/api/outbox.ts), so the policy, the approval and the blocks are the outbox's. An access token is never here: the account holds only the NAME of a secret on the server and whether
 * the server has it. Nothing from a customer's chat is logged or kept by the web.
 */
export const ACCOUNT_STATUSES = ["pending", "active", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type WhatsappAccount = { configured: false } | { configured: true; status: AccountStatus; waba_id: string; phone_number_id: string; display_phone: string | null; coexistence: boolean; token_ref: string; token_available: boolean; updated_at: string | null };

export type ConnectionState = "not_connected" | "connecting" | "connected" | "needs_attention";
/** The four states the Connect page shows, from the account as the API reports it. */
export function connectionState(a: WhatsappAccount): { state: ConnectionState; why: "disabled" | "token_missing" | null } {
  if (!a.configured) return { state: "not_connected", why: null };
  if (a.status === "disabled") return { state: "needs_attention", why: "disabled" };
  if (!a.token_available) return { state: "needs_attention", why: "token_missing" };
  return { state: a.status === "active" ? "connected" : "connecting", why: null };
}

export function parseAccount(json: unknown): WhatsappAccount {
  const x = rec(json, "account");
  if (!bool(x.configured, "configured")) return { configured: false };
  return {
    configured: true,
    status: oneOf(x.status, ACCOUNT_STATUSES, "status"),
    waba_id: word(x.waba_id, "waba_id", 40),
    phone_number_id: word(x.phone_number_id, "phone_number_id", 40),
    display_phone: optStr(x.display_phone, "display_phone", 40),
    coexistence: bool(x.coexistence, "coexistence"),
    token_ref: word(x.token_ref, "token_ref", 80),
    token_available: bool(x.token_available, "token_available"),
    updated_at: optIso(x.updated_at, "updated_at"),
  };
}

export const TEMPLATE_STATUSES = ["draft", "submitted", "approved", "rejected", "paused", "disabled"] as const;
export interface Template {
  id: string;
  name: string;
  language: string;
  purpose: string;
  status: (typeof TEMPLATE_STATUSES)[number];
}
export const parseTemplates = (json: unknown): Template[] =>
  list(rec(json, "templates").templates, "templates", 200).map((t) => {
    const x = rec(t, "template");
    return { id: uuid(x.id, "id"), name: word(x.name, "name", 80), language: word(x.language, "language", 10), purpose: word(x.purpose, "purpose", 30), status: oneOf(x.status, TEMPLATE_STATUSES, "status") };
  });

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return `/v1/tenants/${tenantId}`;
};
const post = (path: string, token: string, body?: unknown) => apiRequest(path, token, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

/** Owner and Admin. */
export async function getWhatsappAccount(token: string, tenantId: string): Promise<WhatsappAccount> {
  return parseAccount(await apiRequest(`${base(tenantId)}/whatsapp/account`, token));
}
export interface AccountInput {
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  coexistence: boolean;
  tokenRef: string;
}
/** Owner, with the second factor. The API keeps only the NAME of the secret (`token_ref`). Saving makes the account `pending`. */
export async function putWhatsappAccount(token: string, tenantId: string, i: AccountInput): Promise<WhatsappAccount> {
  const body: Record<string, unknown> = { waba_id: i.wabaId.trim(), phone_number_id: i.phoneNumberId.trim(), coexistence: i.coexistence, token_ref: i.tokenRef.trim() };
  if (i.displayPhone.trim()) body.display_phone = i.displayPhone.trim();
  return parseAccount(await apiRequest(`${base(tenantId)}/whatsapp/account`, token, { method: "PUT", body: JSON.stringify(body) }));
}
/** Switching on and off: the API answers the row without `token_available`, so the account is read again after the change (the screen then shows what is true, not what was asked for). */
export async function activateWhatsapp(token: string, tenantId: string): Promise<WhatsappAccount> {
  await post(`${base(tenantId)}/whatsapp/account/activate`, token);
  return getWhatsappAccount(token, tenantId);
}
export async function disableWhatsapp(token: string, tenantId: string): Promise<WhatsappAccount> {
  await post(`${base(tenantId)}/whatsapp/account/disable`, token);
  return getWhatsappAccount(token, tenantId);
}
export async function listTemplates(token: string, tenantId: string): Promise<Template[]> {
  return parseTemplates(await apiRequest(`${base(tenantId)}/whatsapp/templates`, token));
}

// ----------------------------------------------------------------------------------------------------------------- the inbox
export interface Conversation {
  lead_id: string;
  name: string | null;
  /** What the API calls the customer: the name, else the phone, else "New enquiry" (never an internal id); absent from an older API. */
  display_name?: string | null;
  company: string | null;
  last_at: string;
  last_direction: "in" | "out";
  preview: string;
  window_open: boolean;
  window_expires_at: string | null;
  unread: boolean;
  stopped: boolean;
}
export interface ConversationPage {
  conversations: Conversation[];
  next_before: string | null;
}
export const DELIVERIES = ["sent", "delivered", "read", "failed"] as const;
export const OUT_STATUSES = ["queued", "needs_approval", "sent", "blocked", "failed"] as const;
export interface ThreadItem {
  direction: "in" | "out";
  id: string;
  at: string;
  text: string;
  /** Outgoing only. */
  status: (typeof OUT_STATUSES)[number] | null;
  /** The outbox's closed reason for the state (why it waits, why it was blocked). */
  reason: string | null;
  delivery: (typeof DELIVERIES)[number] | null;
  delivery_error: string | null;
  failure_code: string | null;
  photos: number;
}
export interface Thread {
  lead_id: string;
  name: string | null;
  display_name?: string | null;
  stopped: boolean;
  whatsapp_consent: "unknown" | "granted" | "withdrawn";
  window_open: boolean;
  window_expires_at: string | null;
  next_before: string | null;
  /** Newest first, as the API sends them. */
  items: ThreadItem[];
}

export function parseConversationPage(json: unknown): ConversationPage {
  const x = rec(json, "conversations");
  return {
    conversations: list(x.conversations, "conversations", 200).map((c) => {
      const r = rec(c, "conversation");
      return {
        lead_id: uuid(r.lead_id, "lead_id"),
        name: optStr(r.name, "name", 200),
        display_name: optStr(r.display_name, "display_name", 200),
        company: optStr(r.company, "company", 200),
        last_at: iso(r.last_at, "last_at"),
        last_direction: oneOf(r.last_direction, ["in", "out"] as const, "last_direction"),
        preview: str(r.preview ?? "", "preview", 400),
        window_open: bool(r.window_open, "window_open"),
        window_expires_at: optIso(r.window_expires_at, "window_expires_at"),
        unread: bool(r.unread, "unread"),
        stopped: bool(r.stopped, "stopped"),
      };
    }),
    next_before: optIso(x.next_before, "next_before"),
  };
}
export function parseThread(json: unknown): Thread {
  const x = rec(json, "thread");
  return {
    lead_id: uuid(x.lead_id, "lead_id"),
    name: optStr(x.name, "name", 200),
    display_name: optStr(x.display_name, "display_name", 200),
    stopped: bool(x.stopped, "stopped"),
    whatsapp_consent: oneOf(x.whatsapp_consent, ["unknown", "granted", "withdrawn"] as const, "whatsapp_consent"),
    window_open: bool(x.window_open, "window_open"),
    window_expires_at: optIso(x.window_expires_at, "window_expires_at"),
    next_before: optIso(x.next_before, "next_before"),
    items: list(x.items, "items", 500).map((i) => {
      const r = rec(i, "item");
      const out = r.direction === "out";
      return {
        direction: oneOf(r.direction, ["in", "out"] as const, "direction"),
        id: uuid(r.id, "id"),
        at: iso(r.at, "at"),
        text: str(r.text ?? "", "text", 5000),
        status: out ? oneOf(r.status, OUT_STATUSES, "status") : null,
        reason: out && r.reason !== null && r.reason !== undefined ? word(r.reason, "reason", 60) : null,
        delivery: r.delivery === null || r.delivery === undefined ? null : oneOf(r.delivery, DELIVERIES, "delivery"),
        delivery_error: r.delivery_error === null || r.delivery_error === undefined ? null : word(r.delivery_error, "delivery_error", 60),
        failure_code: r.failure_code === null || r.failure_code === undefined ? null : word(r.failure_code, "failure_code", 60),
        photos: int(r.photos ?? 0, "photos", 0, 20),
      };
    }),
  };
}

/** Owner, Admin, Sales. Newest conversation first; `before` is the `next_before` of the page before. */
export async function listConversations(token: string, tenantId: string, opts: { limit?: number; before?: string | null } = {}): Promise<ConversationPage> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before) q.set("before", opts.before);
  return parseConversationPage(await apiRequest(`${base(tenantId)}/conversations?${q.toString()}`, token));
}
export async function getThread(token: string, tenantId: string, leadId: string, opts: { limit?: number; before?: string | null } = {}): Promise<Thread> {
  if (!isCanonicalUuid(leadId)) bad("lead id");
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before) q.set("before", opts.before);
  return parseThread(await apiRequest(`${base(tenantId)}/conversations/${leadId}?${q.toString()}`, token));
}
export async function markConversationRead(token: string, tenantId: string, leadId: string): Promise<void> {
  if (!isCanonicalUuid(leadId)) bad("lead id");
  await post(`${base(tenantId)}/conversations/${leadId}/read`, token);
}
