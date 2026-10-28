import { ApiContractError, apiRequest, apiStreamRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { isKnownSource, parseAssistantEvent, parseSource, readSse, type AssistantEvent, type AssistantLanguage } from "./assistant";

/**
 * One conversation for the typed box and the voice circle (contract-conversation.md, 28 Oct), under `/v1/tenants/{id}/assistant`, with the signed-in person's own token (server side only):
 *   POST /turns                            {message_id, conversation_id | null, text, language_hint}  -> server-sent events: intent, step, text, source, draft, confirm_action, clarify, done, error
 *   GET  /conversations?limit&before       the person's own conversations, newest first
 *   GET  /conversations/{id}               the messages (with `kind` and `action`)
 *   POST /conversations/{id}/archive       hides it (nothing is deleted)
 *   POST /actions/{action_id}/confirm      {decision: "yes" | "no"}   (the Owner; with the second factor when the plan says so)
 * There is NO mode switch: the router decides whether a message is small talk, general help, business data or an action, and `done.kind` says what the typed reply is: an answer, a plan to confirm, or one short question.
 */
export const ACTION_STATUSES = ["proposed", "confirmed", "declined", "expired", "running", "done"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const CHANNELS = ["call", "whatsapp", "both"] as const;

export type ConfirmAction = {
  actionId: string;
  title: string;
  summary: string;
  steps: string[];
  count: number | null;
  channel: (typeof CHANNELS)[number] | null;
  estimate: { messages: number; callMinutes: number; costPaise: number } | null;
  needsSecondFactor: boolean;
  expiresAt: string;
  status: ActionStatus;
};

export type TurnEvent = AssistantEvent | { type: "intent"; kind: "smalltalk" | "general" | "business" | "action" } | { type: "confirm_action"; action: ConfirmAction } | { type: "clarify"; question: string; actionId: string | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a conversation turn.`);
};
const text = (v: unknown, what: string, max: number): string => (typeof v === "string" && v.length <= max ? v : bad(what));
const whole = (v: unknown, what: string): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : bad(what));

export function parseConfirmAction(json: unknown): ConfirmAction {
  if (!isRec(json)) return bad("plan");
  const id = json.action_id;
  if (typeof id !== "string" || !isCanonicalUuid(id)) return bad("plan id");
  const est = json.estimate;
  const status = json.status === undefined ? "proposed" : json.status;
  if (!(ACTION_STATUSES as readonly unknown[]).includes(status)) return bad("plan status");
  const channel = json.channel ?? null;
  if (channel !== null && !(CHANNELS as readonly unknown[]).includes(channel)) return bad("plan channel");
  if (!Array.isArray(json.steps) || json.steps.length > 20) return bad("plan steps");
  return {
    actionId: id,
    title: text(json.title, "plan title", 300),
    summary: text(json.summary, "plan summary", 2000),
    steps: json.steps.map((x) => text(x, "plan step", 400)),
    count: json.count === null || json.count === undefined ? null : whole(json.count, "plan count"),
    channel: channel as ConfirmAction["channel"],
    estimate: isRec(est) ? { messages: whole(est.messages, "estimate"), callMinutes: whole(est.call_minutes, "estimate"), costPaise: whole(est.cost_paise, "estimate") } : null,
    needsSecondFactor: json.needs_second_factor === true,
    expiresAt: text(json.expires_at, "plan expiry", 60),
    status: status as ActionStatus,
  };
}

/** One server-sent event of a turn. A source may carry its screen as `open` (this contract) or `target` (Ask's): both are read as the same. A source of a kind this screen does not know is left out. */
export function parseTurnEvent(name: string, data: unknown): TurnEvent | null {
  if (!isRec(data) || data.type !== name) return bad("event");
  switch (name) {
    case "intent":
      return data.kind === "smalltalk" || data.kind === "general" || data.kind === "business" || data.kind === "action" ? { type: "intent", kind: data.kind } : null;
    case "confirm_action":
      return { type: "confirm_action", action: parseConfirmAction(data) };
    case "clarify":
      return { type: "clarify", question: text(data.question, "question", 1000), actionId: typeof data.action_id === "string" && isCanonicalUuid(data.action_id) ? data.action_id : null };
    case "source": {
      const fixed = isRec(data) && data.target === undefined && data.open !== undefined ? { ...data, target: data.open } : data;
      return isKnownSource(fixed) ? { type: "source", ...parseSource(fixed) } : null;
    }
    default:
      return parseAssistantEvent(name, data);
  }
}

export type TurnInput = { messageId: string; conversationId: string | null; text: string; languageHint?: AssistantLanguage | null };
const LANGS = ["te", "en", "hi", "kn"];

export async function* sendTurn(token: string, tenantId: string, input: TurnInput): AsyncGenerator<TurnEvent> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input.messageId) || (input.conversationId !== null && !isCanonicalUuid(input.conversationId))) throw new ApiContractError("id");
  const t = input.text.trim();
  if (t.length < 1 || t.length > 4000) throw new ApiContractError("text");
  const response = await apiStreamRequest(`/v1/tenants/${tenantId}/assistant/turns`, token, { message_id: input.messageId, conversation_id: input.conversationId, text: t, language_hint: input.languageHint && LANGS.includes(input.languageHint) ? input.languageHint : null });
  for await (const { name, data } of readSse(response.body as ReadableStream<Uint8Array>)) {
    const event = parseTurnEvent(name, data);
    if (event !== null) yield event;
  }
}

export type ConversationItem = { id: string; title: string; updatedAt: string; messageCount: number; lastText: string };
export type HistoryMessage = { id: string; role: "user" | "assistant"; text: string; kind: string | null; action: { actionId: string; status: ActionStatus } | null; sources: { label: string }[]; createdAt: string };

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/assistant`;
};

export async function listConversations(token: string, tenantId: string, before?: string): Promise<{ items: ConversationItem[]; nextBefore: string | null }> {
  const q = new URLSearchParams({ limit: "30", ...(before && !Number.isNaN(Date.parse(before)) ? { before } : {}) });
  const json = await apiRequest(`${base(tenantId)}/conversations?${q.toString()}`, token);
  if (!isRec(json) || !Array.isArray(json.items)) return bad("conversation list");
  return {
    items: json.items.slice(0, 30).map((x) => {
      if (!isRec(x) || typeof x.id !== "string" || !isCanonicalUuid(x.id)) return bad("conversation");
      return { id: x.id, title: text(x.title ?? "", "title", 200), updatedAt: text(x.updated_at, "date", 60), messageCount: whole(x.message_count ?? 0, "count"), lastText: text(x.last_text ?? "", "last text", 400) };
    }),
    nextBefore: typeof json.next_before === "string" ? json.next_before : null,
  };
}

export async function getHistory(token: string, tenantId: string, conversationId: string): Promise<HistoryMessage[]> {
  if (!isCanonicalUuid(conversationId)) throw new ApiContractError("id");
  const json = await apiRequest(`${base(tenantId)}/conversations/${conversationId}`, token);
  if (!isRec(json) || !Array.isArray(json.messages)) return bad("conversation");
  return json.messages.slice(0, 400).map((m) => {
    if (!isRec(m) || typeof m.id !== "string" || (m.role !== "user" && m.role !== "assistant")) return bad("message");
    const a = isRec(m.action) && typeof m.action.action_id === "string" && isCanonicalUuid(m.action.action_id) && (ACTION_STATUSES as readonly unknown[]).includes(m.action.status) ? { actionId: m.action.action_id, status: m.action.status as ActionStatus } : null;
    return {
      id: m.id,
      role: m.role,
      text: text(m.text, "text", 12_000),
      kind: typeof m.kind === "string" ? m.kind.slice(0, 30) : null,
      action: a,
      sources: Array.isArray(m.sources) ? m.sources.filter(isKnownSource).slice(0, 8).map((s) => ({ label: parseSource(s).label })) : [],
      createdAt: text(m.created_at ?? "", "date", 60),
    };
  });
}

export async function archiveConversation(token: string, tenantId: string, conversationId: string): Promise<void> {
  if (!isCanonicalUuid(conversationId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/conversations/${conversationId}/archive`, token, { method: "POST", body: JSON.stringify({}) });
}

export type ConfirmResult = { status: "confirmed" | "declined" };
/** Throws ApiRequestError: 403 `mfa_required` (ask for the code, retry), 409 `action_expired`, 409 `action_state`, 404. */
export async function confirmAction(token: string, tenantId: string, actionId: string, decision: "yes" | "no"): Promise<ConfirmResult> {
  if (!isCanonicalUuid(actionId)) throw new ApiContractError("id");
  const json = await apiRequest(`${base(tenantId)}/actions/${actionId}/confirm`, token, { method: "POST", body: JSON.stringify({ decision }) });
  const status = isRec(json) ? json.status : null;
  return status === "confirmed" || status === "declined" ? { status } : bad("confirmation");
}
