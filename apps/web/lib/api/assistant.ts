import { ApiContractError, apiRequest, apiStreamRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The Main agent (job AG): `sendAssistantMessage` streams the answer to one message of the owner, `getConversation` reads a chat back. Server side only, with the signed-in
 * user's own token. A browser cannot call the API (the token stays on the server): a Next route handler passes the events on, e.g.
 * `return new Response(toSseStream(sendAssistantMessage(token, tenantId, input)), { headers: { "Content-Type": "text/event-stream" } })`.
 *
 * What the assistant is, in one paragraph: it READS this business through the signed-in person's own rights, answers with SOURCES, and leaves DRAFTS (a quote the engine
 * priced, a follow-up, a customer reply, a recorded enquiry). It sends nothing, approves nothing and sets no price; every draft card says where to go to approve it.
 *
 * Events, in order: `start`, then any number of `step` (a tool is being used), then `delta` (the finished answer, in pieces), `sources`, `drafts`, and last `done`; or, in place of
 * the last events, `error` with a fixed plain sentence. The model call itself is not streamed token by token. A message that fails is sent again as a NEW message id.
 */
export const ASSISTANT_LANGUAGES = ["en", "te", "hi", "kn", "ta"] as const;
export type AssistantLanguage = (typeof ASSISTANT_LANGUAGES)[number];

export const SOURCE_TYPES = ["quote", "lead", "enquiry", "order", "company", "price_item", "followup_draft", "reply_draft"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const DRAFT_TYPES = ["quote", "followup_draft", "reply_draft", "enquiry"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];
export const OPEN_TYPES = ["quote", "lead", "enquiry", "order"] as const;
export type OpenType = (typeof OPEN_TYPES)[number];

/** Where "Open" goes. Null when the record has no page of its own (a company, a price item). */
export interface OpenTarget {
  type: OpenType;
  id: string;
}

/** Something an answer rests on, found in THIS business in this very message. `label` is a short plain name, read fresh (an erased record reads "(no longer available)"). */
export interface AssistantSource {
  type: SourceType;
  id: string;
  label: string;
  open: OpenTarget | null;
}

/** A DRAFT the assistant left. `status` is always "draft". A reply draft carries the customer-language text, an English gloss and `machine_draft: true` (a machine wrote it). */
export interface DraftCard {
  type: DraftType;
  id: string;
  label: string;
  status: "draft";
  open: OpenTarget | null;
  language: AssistantLanguage | null;
  preview: string | null;
  gloss_en: string | null;
  machine_draft: boolean;
}

export type AssistantEvent =
  | { event: "start"; conversation_id: string; message_id: string; language: AssistantLanguage; replayed: boolean }
  | { event: "step"; tool: string }
  | { event: "delta"; text: string }
  | { event: "sources"; sources: AssistantSource[] }
  | { event: "drafts"; drafts: DraftCard[] }
  | { event: "done"; message_id: string; conversation_id: string; language: AssistantLanguage | null; kind: "answer" | "refusal" | "clarify" | "replayed" }
  | { event: "error"; code: string; message: string };

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  language: AssistantLanguage | null;
  sources: AssistantSource[];
  drafts: DraftCard[];
  created_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  messages: AssistantMessage[];
}

export interface SendAssistantInput {
  /** The caller's own id for this message: sending the same id again replays the stored answer and spends nothing. */
  messageId: string;
  /** Leave out to start a chat; give the id of an earlier event's `conversation_id` to go on. Your own uuid is fine too. */
  conversationId?: string;
  /** 1 to 4000 characters. */
  text: string;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an assistant response.`);
}
const str = (v: unknown, what: string, max = 20_000): string => (typeof v === "string" && v.length <= max ? v : bad(what));
const uuid = (v: unknown, what: string): string => (typeof v === "string" && isCanonicalUuid(v) ? v : bad(what));
const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : bad(what));
const nullable = <T>(v: unknown, f: (x: unknown) => T): T | null => (v === null ? null : f(v));

export function parseOpenTarget(json: unknown): OpenTarget {
  if (!isRecord(json)) return bad("open target");
  return { type: oneOf(OPEN_TYPES, json.type, "open type"), id: uuid(json.id, "open id") };
}

export function parseSource(json: unknown): AssistantSource {
  if (!isRecord(json)) return bad("source");
  return {
    type: oneOf(SOURCE_TYPES, json.type, "source type"),
    id: uuid(json.id, "source id"),
    label: str(json.label, "source label", 300),
    open: json.open === null || json.open === undefined ? null : parseOpenTarget(json.open),
  };
}

export function parseDraftCard(json: unknown): DraftCard {
  if (!isRecord(json)) return bad("draft card");
  if (json.status !== "draft") return bad("draft status");
  if (typeof json.machine_draft !== "boolean") return bad("machine_draft");
  return {
    type: oneOf(DRAFT_TYPES, json.type, "draft type"),
    id: uuid(json.id, "draft id"),
    label: str(json.label, "draft label", 300),
    status: "draft",
    open: json.open === null || json.open === undefined ? null : parseOpenTarget(json.open),
    language: nullable(json.language ?? null, (x) => oneOf(ASSISTANT_LANGUAGES, x, "draft language")),
    preview: nullable(json.preview ?? null, (x) => str(x, "preview", 4000)),
    gloss_en: nullable(json.gloss_en ?? null, (x) => str(x, "gloss", 4000)),
    machine_draft: json.machine_draft,
  };
}

const list = <T>(v: unknown, f: (x: unknown) => T, what: string, max = 50): T[] => (Array.isArray(v) && v.length <= max ? v.map(f) : bad(what));

/** One server-sent event as the screens get it. An event the API does not send is a contract error: nothing is guessed. */
export function parseAssistantEvent(name: string, data: unknown): AssistantEvent {
  if (!isRecord(data)) return bad("event");
  switch (name) {
    case "start":
      return {
        event: "start",
        conversation_id: uuid(data.conversation_id, "conversation_id"),
        message_id: uuid(data.message_id, "message_id"),
        language: oneOf(ASSISTANT_LANGUAGES, data.language, "language"),
        replayed: typeof data.replayed === "boolean" ? data.replayed : bad("replayed"),
      };
    case "step":
      return { event: "step", tool: str(data.tool, "tool", 60) };
    case "delta":
      return { event: "delta", text: str(data.text, "delta") };
    case "sources":
      return { event: "sources", sources: list(data.sources, parseSource, "sources", 20) };
    case "drafts":
      return { event: "drafts", drafts: list(data.drafts, parseDraftCard, "drafts", 10) };
    case "done":
      return {
        event: "done",
        message_id: uuid(data.message_id, "message_id"),
        conversation_id: uuid(data.conversation_id, "conversation_id"),
        language: nullable(data.language ?? null, (x) => oneOf(ASSISTANT_LANGUAGES, x, "language")),
        kind: oneOf(["answer", "refusal", "clarify", "replayed"] as const, data.kind, "kind"),
      };
    case "error":
      return { event: "error", code: str(data.code, "code", 60), message: str(data.message, "message", 400) };
    default:
      return bad(`event name "${name.slice(0, 20)}"`);
  }
}

/** Reads a server-sent-events body: yields each (event, data) pair as it completes. Chunks may split an event, and a Telugu letter, anywhere. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ name: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let name = "";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) name = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (name) {
          try {
            yield { name, data: JSON.parse(data) };
          } catch (error) {
            if (error instanceof SyntaxError) return bad("event data");
            throw error;
          }
        }
        cut = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * `POST /v1/tenants/{tenant}/assistant/messages`: the owner's message in, the assistant's answer out as a stream of events. Throws before the first event when the API refuses
 * (ApiRequestError with the API's fixed sentence: 409 agents_disabled, 429 cost_cap_reached or run_limit_reached, 403 forbidden, 422, 409 message_id_used, 503 assistant_unavailable).
 */
export async function* sendAssistantMessage(accessToken: string, tenantId: string, input: SendAssistantInput): AsyncGenerator<AssistantEvent> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input.messageId) || (input.conversationId !== undefined && !isCanonicalUuid(input.conversationId))) throw new ApiContractError("id");
  const text = input.text.trim();
  if (text.length < 1 || text.length > 4000) throw new ApiContractError("text");
  const response = await apiStreamRequest(`/v1/tenants/${tenantId}/assistant/messages`, accessToken, {
    message_id: input.messageId,
    ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    text,
  });
  for await (const { name, data } of readSse(response.body as ReadableStream<Uint8Array>)) yield parseAssistantEvent(name, data);
}

export function parseMessage(json: unknown): AssistantMessage {
  if (!isRecord(json)) return bad("message");
  return {
    id: uuid(json.id, "message id"),
    role: oneOf(["user", "assistant"] as const, json.role, "role"),
    text: str(json.text, "text", 12_000),
    language: nullable(json.language ?? null, (x) => oneOf(ASSISTANT_LANGUAGES, x, "language")),
    sources: list(json.sources, parseSource, "sources", 20),
    drafts: list(json.drafts, parseDraftCard, "drafts", 10),
    created_at: str(json.created_at, "created_at", 60),
  };
}

export function parseConversation(json: unknown): Conversation {
  if (!isRecord(json)) return bad("conversation");
  return {
    id: uuid(json.id, "conversation id"),
    created_at: str(json.created_at, "created_at", 60),
    updated_at: str(json.updated_at, "updated_at", 60),
    messages: list(json.messages, parseMessage, "messages", 400),
  };
}

/** `GET /v1/tenants/{tenant}/assistant/conversations/{id}`: a chat as stored, with sources and draft cards read fresh. 404 for a chat that is not yours, erased or unknown. */
export async function getConversation(accessToken: string, tenantId: string, conversationId: string): Promise<Conversation> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(conversationId)) throw new ApiContractError("id");
  return parseConversation(await apiRequest(`/v1/tenants/${tenantId}/assistant/conversations/${conversationId}`, accessToken));
}
