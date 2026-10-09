import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getConversation, parseAssistantEvent, parseConversation, parseDraftCard, parseSource, readSse, sendAssistantMessage } from "./assistant";

const TENANT = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-10-09T09:30:00Z";

const SOURCE = { kind: "quote", id: ID, label: "Quote 3 for Harbour Retail", target: { type: "quote", id: ID } };
const DRAFT = { id: ID, kind: "reply_draft", title: "Reply draft (machine-written)", summary: "నమస్కారం", status: "draft", target: { type: "lead", id: ID }, language: "te", gloss_en: "Hello", machine_draft: true };

function sse(events: Array<[string, unknown]>): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}
function streamOf(text: string, cut = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.slice(i, i + cut));
      controller.close();
    },
  });
}
async function collect<T>(it: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

beforeEach(() => vi.clearAllMocks());

describe("sources and draft cards", () => {
  it("parse the contract's shape", () => {
    expect(parseSource(SOURCE)).toEqual(SOURCE);
    expect(parseSource({ ...SOURCE, kind: "company", target: null }).target).toBeNull();
    expect(parseDraftCard(DRAFT)).toEqual(DRAFT);
  });
  it.each([["kind", "dashboard"], ["id", "x"], ["label", 5], ["target", { type: "company", id: ID }]])("a source with %s = %j is a contract error", (k, v) => {
    expect(() => parseSource({ ...SOURCE, [k]: v })).toThrow(ApiContractError);
  });
  it.each([["status", "sent"], ["status", "approved"], ["machine_draft", "yes"], ["kind", "order"], ["language", "fr"], ["title", 5], ["summary", null], ["target", { type: "dashboard", id: ID }]])("a draft card with %s = %j is a contract error", (k, v) => {
    expect(() => parseDraftCard({ ...DRAFT, [k]: v })).toThrow(ApiContractError);
  });
  it("a draft card is always a draft, never sent or approved", () => {
    expect(parseDraftCard(DRAFT).status).toBe("draft");
  });
});

describe("events", () => {
  it("parses every event the API sends, in the box's shape", () => {
    expect(parseAssistantEvent("text", { type: "text", delta: "ఈ రోజు" })).toEqual({ type: "text", delta: "ఈ రోజు" });
    expect(parseAssistantEvent("source", { type: "source", ...SOURCE })).toEqual({ type: "source", ...SOURCE });
    expect(parseAssistantEvent("draft", { type: "draft", ...DRAFT })).toEqual({ type: "draft", ...DRAFT });
    expect(parseAssistantEvent("done", { type: "done", message_id: MSG, conversation_id: CONV, language: "en", kind: "answer" })).toMatchObject({ type: "done", kind: "answer", conversation_id: CONV });
    expect(parseAssistantEvent("error", { type: "error", code: "cost_cap_reached", message: "The daily limit is reached." })).toMatchObject({ type: "error", code: "cost_cap_reached" });
  });
  it("refuses an event name or a shape the API does not send", () => {
    expect(() => parseAssistantEvent("send_email", { type: "send_email" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("start", { type: "start" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("text", { type: "done", delta: "x" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("text", { delta: "x" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("done", { type: "done", conversation_id: "x", message_id: MSG, language: "en", kind: "answer" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("done", { type: "done", conversation_id: CONV, message_id: MSG, language: "en", kind: "sent" })).toThrow(ApiContractError);
    expect(() => parseAssistantEvent("text", null)).toThrow(ApiContractError);
  });
});

describe("readSse", () => {
  it("reassembles events split anywhere, including inside a Telugu letter", async () => {
    const body = sse([["text", { type: "text", delta: "ఈ రోజు రెండు కోట్స్" }], ["text", { type: "text", delta: "వేచి ఉన్నాయి" }]]);
    for (const cut of [1, 2, 3, 5, 11]) {
      const got = await collect(readSse(streamOf(body, cut)));
      expect(got.map((g) => (g.data as { delta: string }).delta)).toEqual(["ఈ రోజు రెండు కోట్స్", "వేచి ఉన్నాయి"]);
    }
  });
  it("an event with data that is not JSON is a contract error", async () => {
    await expect(collect(readSse(streamOf("event: text\ndata: {nope\n\n")))).rejects.toThrow(ApiContractError);
  });
});

describe("sendAssistantMessage", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/"));
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("posts the message with the caller's token and yields the parsed events in order", async () => {
    const body = sse([
      ["text", { type: "text", delta: "Two quotes are waiting." }],
      ["source", { type: "source", ...SOURCE }],
      ["draft", { type: "draft", ...DRAFT }],
      ["done", { type: "done", message_id: MSG, conversation_id: CONV, language: "en", kind: "answer" }],
    ]);
    const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const events = await collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, text: "  What is waiting?  " }));
    expect(events.map((e) => e.type)).toEqual(["text", "source", "draft", "done"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/assistant/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ message_id: MSG, text: "What is waiting?" });
  });
  it("sends the conversation id when going on with a chat", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, conversationId: CONV, text: "and now?" }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ conversation_id: CONV });
  });
  it("throws before the first event when the API refuses, with its fixed sentence", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "agents_disabled", message: "The assistant is switched off." } }), { status: 409 })) as unknown as typeof fetch;
    await expect(collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, text: "hi" }))).rejects.toMatchObject({ status: 409, code: "agents_disabled" });
    await expect(collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, text: "hi" }))).rejects.toBeInstanceOf(ApiRequestError);
  });
  it("refuses bad input before any request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, text: "   " }))).rejects.toThrow(ApiContractError);
    await expect(collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, text: "x".repeat(4001) }))).rejects.toThrow(ApiContractError);
    await expect(collect(sendAssistantMessage("tok", "nope", { messageId: MSG, text: "hi" }))).rejects.toThrow(ApiContractError);
    await expect(collect(sendAssistantMessage("tok", TENANT, { messageId: MSG, conversationId: "nope", text: "hi" }))).rejects.toThrow(ApiContractError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getConversation", () => {
  const CONVERSATION = {
    id: CONV,
    created_at: AT,
    updated_at: AT,
    messages: [
      { id: MSG, role: "user", text: "What is waiting?", language: "en", sources: [], drafts: [], created_at: AT },
      { id: ID, role: "assistant", text: "One quote.", language: "en", sources: [SOURCE], drafts: [DRAFT], created_at: AT },
    ],
  };
  it("reads a chat back through the API client", async () => {
    apiRequest.mockResolvedValueOnce(CONVERSATION);
    await expect(getConversation("tok", TENANT, CONV)).resolves.toEqual(CONVERSATION);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/assistant/conversations/${CONV}`, "tok");
  });
  it("refuses a bad id and a bad shape", async () => {
    await expect(getConversation("tok", TENANT, "x")).rejects.toThrow(ApiContractError);
    expect(() => parseConversation({ ...CONVERSATION, messages: [{ ...CONVERSATION.messages[0], role: "system" }] })).toThrow(ApiContractError);
    expect(() => parseConversation(null)).toThrow(ApiContractError);
  });
});
