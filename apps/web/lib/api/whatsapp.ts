import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, oneOf, optIso, optStr, readRows, rec, str, uuid, word } from "./shape";

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
  /** The words of the opt-out button of a marketing template ("Stop promotions"), or null (C1, 16 Nov). */
  optOutLabel?: string | null;
  /** The name WhatsApp knows it by when that is not ours ("visit_reminder_v2"), or null (C1, 16 Nov). */
  metaName?: string | null;
  /** The template's words with {{1}} the first name, {{2}} the business, {{3}} the offer label (offers); null when the API does not send them. */
  body?: string | null;
}
export const parseTemplates = (json: unknown): Template[] =>
  list(rec(json, "templates").templates, "templates", 200).map((t) => {
    const x = rec(t, "template");
    return { id: uuid(x.id, "id"), name: word(x.name, "name", 80), language: word(x.language, "language", 10), purpose: word(x.purpose, "purpose", 30), status: oneOf(x.status, TEMPLATE_STATUSES, "status"), optOutLabel: typeof x.opt_out_label === "string" && x.opt_out_label.trim() !== "" ? x.opt_out_label.slice(0, 40) : null, metaName: typeof x.meta_name === "string" && x.meta_name.trim() !== "" ? x.meta_name.slice(0, 80) : null, body: typeof x.body === "string" && x.body.trim() !== "" ? x.body.slice(0, 1100) : null };
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
/** "Disconnect" (Owner + second factor): C1's `POST /whatsapp/disconnect` switches the account off and takes our app off the account's webhooks; the account row stays with `status: "disabled"` (nothing of the chats is touched). */
export async function disconnectWhatsapp(token: string, tenantId: string): Promise<WhatsappAccount> {
  await post(`${base(tenantId)}/whatsapp/disconnect`, token);
  return getWhatsappAccount(token, tenantId);
}
/**
 * "Connect with Facebook" (Meta Embedded Signup, Customer Zero; C1's `GET /whatsapp/connect/config`, Owner and Admin): what the browser needs to open Meta's window: our public app id, the signup configuration id and the Graph version.
 * `available` is false until the server has all it needs (`missing` names what is not there). The app SECRET never comes here.
 */
export interface ConnectConfig {
  available: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  missing: string[];
  /** What the API can record (`cloud_api`, `coexistence`); empty from an older API: the web then never sends the `coexistence` field. */
  onboardingTypes: string[];
  /** The Embedded Signup version of the owner's configuration (`v4`: the app-coexistence feature type is opted into; `v5`, 20 Oct 2026: coexistence is on by default). An older API says nothing: v4. */
  embeddedVersion: "v4" | "v5";
  /** The `extras` of `FB.login`, ready-made by the API for this version: passed to Meta as they are. null from an older API: the web then uses the v4 ones it always used. */
  launchExtras: Record<string, unknown> | null;
}
export function parseConnectConfig(json: unknown): ConnectConfig {
  const x = rec(json, "connect config");
  const id = (v: unknown, what: string): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "string" && /^[0-9A-Za-z_-]{3,40}$/.test(v) ? v : bad(what));
  const version = typeof x.graph_version === "string" && /^v\d{1,2}\.\d{1,2}$/.test(x.graph_version) ? x.graph_version : "v25.0";
  const appId = id(x.app_id, "app_id");
  const configId = id(x.config_id, "config_id");
  const embeddedVersion: "v4" | "v5" = x.embedded_version === "v5" ? "v5" : "v4";
  const extras = typeof x.launch_extras === "object" && x.launch_extras !== null && !Array.isArray(x.launch_extras) && JSON.stringify(x.launch_extras).length <= 600 ? (x.launch_extras as Record<string, unknown>) : null;
  return { embeddedVersion, launchExtras: extras, available: bool(x.available, "available") && appId !== null && configId !== null, appId, configId, graphVersion: version, missing: list(x.missing ?? [], "missing", 20).map((m) => word(m, "missing")), onboardingTypes: list(x.onboarding_types ?? [], "onboarding_types", 10).map((m) => word(m, "onboarding_type")) };
}
/** null when it cannot be told (an API without the route, a failure): the card then says "being set up" and draws no button. */
export async function getConnectConfig(token: string, tenantId: string): Promise<ConnectConfig | null> {
  try {
    return parseConnectConfig(await apiRequest(`${base(tenantId)}/whatsapp/connect/config`, token));
  } catch {
    return null;
  }
}

/** What Meta's Embedded Signup gave the browser: the short `code` and the account and number the shop picked. No token, no secret. */
export interface ConnectInput {
  code: string;
  /** Version 4 names the account `waba_id`; version 5 (20 Oct 2026) names the accounts `messaging_account_ids` instead: the API accepts either and checks the ids against what the signup really shared. */
  wabaId?: string;
  messagingAccountIds?: string[];
  /** Version 5 may not name the number: the API then takes the account's only number. */
  phoneNumberId?: string;
  /** Version 5's own fact: the number is also on the WhatsApp Business app (Meta's `is_on_biz_app`). */
  isOnBizApp?: boolean;
  /** true only when the signup was Meta's app-onboarding one AND the API said it can record it (`onboarding_types` has "coexistence"); otherwise absent, because the API's model is strict (an unknown field is a 422). */
  coexistence?: true;
}
export interface Connected {
  connected: boolean;
  displayPhone: string | null;
  verifiedName: string | null;
  status: string | null;
}
export const SIGNUP_ID = /^[0-9]{5,30}$/;
export const SIGNUP_CODE = /^[A-Za-z0-9_.~-]{10,512}$/;
/** `POST /whatsapp/connect` (Owner, with the second factor): the API checks that the signup was made in OUR app and shared THIS account, that the number is on it, subscribes our app to its webhooks and records the account for this business only. */
export async function connectWhatsapp(token: string, tenantId: string, i: ConnectInput): Promise<Connected> {
  const ids = i.messagingAccountIds ?? [];
  const named = (i.wabaId !== undefined && SIGNUP_ID.test(i.wabaId)) || (ids.length > 0 && ids.length <= 5 && ids.every((x) => SIGNUP_ID.test(x)));
  if (!named || (i.wabaId !== undefined && !SIGNUP_ID.test(i.wabaId)) || (i.phoneNumberId !== undefined && !SIGNUP_ID.test(i.phoneNumberId)) || !SIGNUP_CODE.test(i.code)) bad("signup");
  const body: Record<string, unknown> = { code: i.code };
  if (i.wabaId !== undefined) body.waba_id = i.wabaId;
  if (ids.length > 0) body.messaging_account_ids = ids;
  if (i.phoneNumberId !== undefined) body.phone_number_id = i.phoneNumberId;
  if (i.coexistence === true) body.coexistence = true;
  if (typeof i.isOnBizApp === "boolean") body.is_on_biz_app = i.isOnBizApp;
  const x = rec(await post(`${base(tenantId)}/whatsapp/connect`, token, body), "connected");
  return { connected: bool(x.connected, "connected"), displayPhone: optStr(x.display_phone, "display_phone", 40), verifiedName: optStr(x.verified_name, "verified_name", 100), status: optStr(x.status, "status", 20) };
}
export async function listTemplates(token: string, tenantId: string): Promise<Template[]> {
  return parseTemplates(await apiRequest(`${base(tenantId)}/whatsapp/templates`, token));
}
/** The Owner sends the drafts to WhatsApp for review, one or all (C1, 16 Nov; the second factor is asked by the API: 403 mfa_required at aal1). The answer is the templates as they stand now, so the status pills can be drawn from it. */
/** A draft WhatsApp did not take, with the one fixed sentence why (C1, 16 Nov): the screen always says it, so a send is never silent. `code` is one of name_exists, rate_limited, not_allowed, unavailable, invalid_content, refused. */
export interface FailedTemplate {
  id: string;
  name: string;
  language: string;
  code: string;
  reason: string;
  /** What WhatsApp itself said, when it said something. */
  metaMessage: string | null;
}
/** A draft WhatsApp already held under that name in that language, sent under a new one (C1's `renamed`, 16 Nov: the API tries _v2, _v3 itself). */
export interface RenamedTemplate {
  id: string;
  name: string;
  language: string;
  metaName: string;
}
export const parseRenamedTemplate = (json: unknown): RenamedTemplate => {
  const x = rec(json, "renamed template");
  return { id: uuid(x.id, "id"), name: word(x.name, "name", 80), language: word(x.language, "language", 10), metaName: word(x.meta_name, "meta_name", 80) };
};
export const parseFailedTemplate = (json: unknown): FailedTemplate => {
  const x = rec(json, "failed template");
  return { id: uuid(x.id, "id"), name: word(x.name, "name", 80), language: word(x.language, "language", 10), code: word(x.code, "code", 40), reason: str(x.reason, "reason", 400), metaMessage: typeof x.meta_message === "string" && x.meta_message.trim() !== "" ? x.meta_message.trim().slice(0, 300) : null };
};
export async function submitTemplateDrafts(token: string, tenantId: string, confirm = false): Promise<{ submitted: number; refused: number; failed: FailedTemplate[]; renamed: RenamedTemplate[]; templates: Template[] }> {
  const x = rec(await post(`${base(tenantId)}/whatsapp/templates/submit-drafts`, token, confirm ? { confirm: true } : undefined), "submit drafts");
  return { submitted: int(x.submitted, "submitted", 0, 1000), refused: int(x.refused, "refused", 0, 1000), failed: x.failed === undefined ? [] : readRows(x.failed, "failed templates", parseFailedTemplate, 100), renamed: x.renamed === undefined ? [] : readRows(x.renamed, "renamed templates", parseRenamedTemplate, 100), templates: parseTemplates({ templates: x.templates }) };
}
export async function submitTemplate(token: string, tenantId: string, templateId: string, confirm = false): Promise<Template> {
  if (!isCanonicalUuid(templateId)) bad("template id");
  const x = rec(await post(`${base(tenantId)}/whatsapp/templates/${templateId}/submit`, token, confirm ? { confirm: true } : undefined), "submit template");
  return parseTemplates({ templates: [x.template] })[0] ?? bad("template");
}
/** "Check WhatsApp's answer": asks WhatsApp what became of the templates under review. No second factor. */
export async function syncTemplates(token: string, tenantId: string): Promise<{ changed: number; templates: Template[] }> {
  const x = rec(await post(`${base(tenantId)}/whatsapp/templates/sync`, token), "sync templates");
  return { changed: int(x.changed, "changed", 0, 1000), templates: parseTemplates({ templates: x.templates }) };
}

// ------------------------------------------------------------------------------------ a template for ONE chat (24 hour window closed)
/** A variable of a chat template: its name, a label, and the value the system filled in for this lead (first name, business name). Read-only: a template variable never holds free text (owner, 15 Nov). */
export interface ChatTemplateVariable {
  key: string;
  label: string;
  value: string | null;
}
/** An APPROVED template in the chat's language, with the words already filled in for this lead (C1's `GET /conversations/{lead_id}/templates`, 16 Nov). */
export interface ChatTemplate {
  id: string;
  name: string;
  language: string;
  purpose: string;
  preview: string;
  variables: ChatTemplateVariable[];
}
export const parseChatTemplate = (json: unknown): ChatTemplate => {
  const x = rec(json, "chat template");
  return {
    id: uuid(x.id, "id"),
    name: word(x.name, "name", 80),
    language: word(x.language, "language", 10),
    purpose: word(x.purpose, "purpose", 30),
    preview: str(x.preview, "preview", 1200),
    variables: readRows(x.variables ?? [], "chat template variables", (v) => {
      const r = rec(v, "variable");
      return { key: word(r.key, "key", 40), label: str(r.label, "label", 80), value: optStr(r.value, "value", 200) };
    }, 8),
  };
};
const leadPath = (tenantId: string, leadId: string): string => {
  if (!isCanonicalUuid(leadId)) bad("lead id");
  return `${base(tenantId)}/conversations/${leadId}`;
};
/** The approved templates the owner may send to this chat (an empty list = none is approved). A row that is not the contract's shape is left out. */
export async function listChatTemplates(token: string, tenantId: string, leadId: string): Promise<ChatTemplate[]> {
  const json = await apiRequest(`${leadPath(tenantId, leadId)}/templates`, token);
  return readRows(rec(json, "chat templates").items, "chat templates", parseChatTemplate, 50);
}
/** Send one of them: `{template_id}` only (never words, never variables). It goes through the outbox like a reply; the answer is the outbox's state and closed reason. */
export async function sendChatTemplate(token: string, tenantId: string, leadId: string, templateId: string): Promise<{ status: string; reason: string }> {
  if (!isCanonicalUuid(templateId)) bad("template id");
  const json = rec(await post(`${leadPath(tenantId, leadId)}/template`, token, { template_id: templateId }), "template send");
  const m = typeof json.message === "object" && json.message !== null ? rec(json.message, "message") : json;
  return { status: str(m.status, "status", 40), reason: typeof m.reason === "string" ? m.reason.slice(0, 80) : "" };
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
  /** Design system v6, all optional (an API from before them sends none; lib/chats/handling.ts derives the rest). C1's `handled_by` (needs_you | assistant | done; an older draft said owner), the per-chat `assistant_enabled`, `reply_ready` (a reply of the assistant waits for the owner's OK) and an `outcome` word (a call category such as visit_booked). */
  handledBy?: HandledBy | null;
  assistantEnabled?: boolean | null;
  replyReady?: boolean | null;
  outcome?: string | null;
}
export const HANDLED_BY = ["assistant", "owner", "needs_you", "done"] as const;
export type HandledBy = (typeof HANDLED_BY)[number];
const handledBy = (v: unknown): HandledBy | null => (typeof v === "string" && (HANDLED_BY as readonly string[]).includes(v) ? (v as HandledBy) : null);
const optBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const optWord = (v: unknown): string | null => (typeof v === "string" && /^[a-z_]{1,40}$/.test(v) ? v : null);
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
  /** `unknown`: a word a newer API sent that this screen does not know; the message is still shown, with no status line (owner, 17 Nov). */
  status: (typeof OUT_STATUSES)[number] | "unknown" | null;
  /** The outbox's closed reason for the state (why it waits, why it was blocked). */
  reason: string | null;
  delivery: (typeof DELIVERIES)[number] | null;
  delivery_error: string | null;
  failure_code: string | null;
  photos: number;
  /** Who made an outgoing message (the outbox's `source`); absent from an API from before design system v6. */
  by?: "assistant" | "owner" | "system" | null;
  /** Why a message did not go and what to do (C1, 16 Nov): `text` is the one-sentence why, `nextStep` what to try, `action` the button the screen draws. null = it went or is on its way; absent from an API from before it (the screen reads `reason` and `failure_code` itself then). */
  notSent?: NotSent | null;
}
export const NOT_SENT_ACTIONS = ["send_template", "open_approvals", "open_templates", "open_consent", "open_settings", "check_number", "wait", "none"] as const;
export interface NotSent {
  code: string;
  text: string;
  nextStep: string | null;
  action: (typeof NOT_SENT_ACTIONS)[number];
}
/** A `not_sent` that is not the contract's shape is no explanation (the screen reads the reason itself); it never breaks the thread. */
const safeNotSent = (v: unknown): NotSent | null => {
  try {
    return parseNotSent(v);
  } catch {
    return null;
  }
};
export function parseNotSent(v: unknown): NotSent | null {
  if (v === null || v === undefined) return null;
  const x = rec(v, "not_sent");
  const action = (NOT_SENT_ACTIONS as readonly unknown[]).includes(x.action) ? (x.action as NotSent["action"]) : "none"; // an action this screen does not know is no button
  return { code: word(x.code, "code", 60), text: str(x.text, "text", 400), nextStep: typeof x.next_step === "string" && x.next_step.trim() !== "" ? x.next_step.trim().slice(0, 300) : null, action };
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
  /** Design system v6: the per-chat switch (C1's `assistant_enabled`); null = the API does not say. */
  assistantEnabled?: boolean | null;
}

/** The direction of a chat or a message: "in" or "out". A word this screen does not know is shown as the customer's (a message to look at) and logged, never a broken chat list (owner, 17 Nov). */
function directionRead(v: unknown): "in" | "out" {
  if (v === "in" || v === "out") return v;
  console.warn(`Chats: an unknown direction "${String(v).slice(0, 40)}" is shown as the customer's`);
  return "in";
}
function outStatusRead(v: unknown): (typeof OUT_STATUSES)[number] | "unknown" {
  if (typeof v === "string" && (OUT_STATUSES as readonly string[]).includes(v)) return v as (typeof OUT_STATUSES)[number];
  console.warn(`Chats: an unknown message status "${String(v).slice(0, 40)}" is shown with no status line`);
  return "unknown";
}
function deliveryRead(v: unknown): (typeof DELIVERIES)[number] | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && (DELIVERIES as readonly string[]).includes(v)) return v as (typeof DELIVERIES)[number];
  console.warn(`Chats: an unknown delivery word "${String(v).slice(0, 40)}" is not shown`);
  return null;
}

export function parseConversationPage(json: unknown): ConversationPage {
  const x = rec(json, "conversations");
  return {
    conversations: readRows(x.conversations, "conversations", (c) => {
      const r = rec(c, "conversation");
      return {
        lead_id: uuid(r.lead_id, "lead_id"),
        name: optStr(r.name, "name", 200),
        display_name: optStr(r.display_name, "display_name", 200),
        company: optStr(r.company, "company", 200),
        last_at: iso(r.last_at, "last_at"),
        last_direction: directionRead(r.last_direction),
        preview: str(r.preview ?? "", "preview", 400),
        window_open: bool(r.window_open, "window_open"),
        window_expires_at: optIso(r.window_expires_at, "window_expires_at"),
        unread: bool(r.unread, "unread"),
        stopped: bool(r.stopped, "stopped"),
        handledBy: handledBy(r.handled_by),
        assistantEnabled: optBool(r.assistant_enabled),
        replyReady: optBool(r.reply_ready),
        outcome: optWord(r.outcome),
      };
    }, 200),
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
    assistantEnabled: optBool(x.assistant_enabled),
    items: readRows(x.items, "messages", (i) => {
      const r = rec(i, "item");
      const direction = directionRead(r.direction);
      const out = direction === "out";
      return {
        direction,
        id: uuid(r.id, "id"),
        at: iso(r.at, "at"),
        text: str(r.text ?? "", "text", 5000),
        status: out ? outStatusRead(r.status) : null,
        reason: out && r.reason !== null && r.reason !== undefined ? word(r.reason, "reason", 60) : null,
        delivery: deliveryRead(r.delivery),
        delivery_error: r.delivery_error === null || r.delivery_error === undefined ? null : word(r.delivery_error, "delivery_error", 60),
        failure_code: r.failure_code === null || r.failure_code === undefined ? null : word(r.failure_code, "failure_code", 60),
        photos: int(r.photos ?? 0, "photos", 0, 20),
        by: r.by === "assistant" || r.by === "owner" || r.by === "system" ? r.by : null,
        notSent: out ? safeNotSent(r.not_sent) : null,
      };
    }, 500),
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

/** "Assistant: on/off" for ONE chat (C1's `POST /conversations/{lead_id}/assistant {enabled}`, 13 Nov 2026; Owner, Admin, Sales; audited). Off = the auto-reply worker leaves that customer to a person. */
export async function setConversationAssistant(token: string, tenantId: string, leadId: string, enabled: boolean): Promise<void> {
  if (!isCanonicalUuid(leadId)) bad("lead id");
  await post(`${base(tenantId)}/conversations/${leadId}/assistant`, token, { enabled });
}
