import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantEvent } from "@/lib/api/assistant";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, send: vi.fn(), quote: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/assistant", () => ({ sendAssistantMessage: (...a: unknown[]) => h.send(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuote: (...a: unknown[]) => h.quote(...a) }));

import { POST } from "./route";

const HOST = "app.example.test";
function post(body: unknown, headers: Record<string, string> = { origin: `https://${HOST}`, host: HOST }, tenant = T) {
  const request = new NextRequest(`https://${HOST}/app/tenants/${tenant}/ask`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  return POST(request, { params: Promise.resolve({ tenantId: tenant }) });
}
const good = { text: "What is waiting?", messageId: M, conversationId: C };
async function lines(r: Response) {
  return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function stream(events: AssistantEvent[], failAfter?: unknown) {
  return async function* () {
    yield* events;
    if (failAfter) throw failAfter;
  };
}
const done: AssistantEvent = { type: "done", conversation_id: C, message_id: M, language: "en", kind: "answer" };

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.send.mockReset();
  h.quote.mockReset();
});

describe("POST /app/tenants/[id]/ask", () => {
  it("asks the Main agent with the PERSON's token and ids, and returns one JSON event per line", async () => {
    h.send.mockImplementation(stream([{ type: "text", delta: "Hi" }, done]));
    const r = await post(good);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await lines(r)).toEqual([{ type: "text", delta: "Hi" }, { type: "done" }]);
    expect(h.send).toHaveBeenCalledWith("person-token", T, { messageId: M, conversationId: C, text: "What is waiting?" });
  });
  it("turns a quote source into the enquiry page, reading the quote with the person's token", async () => {
    h.quote.mockResolvedValue({ enquiry_id: E });
    h.send.mockImplementation(stream([{ type: "source", kind: "quote", id: Q, label: "Quote 3", target: { type: "quote", id: Q } }, done]));
    expect(await lines(await post(good))).toEqual([{ type: "source", label: "Quote 3", href: `/app/tenants/${T}/enquiries/${E}?quote=${Q}` }, { type: "done" }]);
    expect(h.quote).toHaveBeenCalledWith("person-token", T, Q);
  });
  it("asks once for a quote named twice, and falls back to the list of quotes when it cannot be read", async () => {
    h.quote.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    const src = (id: string): AssistantEvent => ({ type: "source", kind: "quote", id, label: "Q", target: { type: "quote", id } });
    h.send.mockImplementation(stream([src(Q), { type: "draft", id: Q, kind: "quote", title: "t", summary: "s", status: "draft", target: { type: "quote", id: Q }, language: null, gloss_en: null, machine_draft: false }, done]));
    const out = await lines(await post(good));
    expect(out[0].href).toBe(`/app/tenants/${T}/quotes`);
    expect(out[1].href).toBe(`/app/tenants/${T}/quotes`);
    expect(h.quote).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["the cost cap", new ApiRequestError(429, "ai_paused_until", "Today's cap"), "ai_paused_until"],
    ["the run limit", new ApiRequestError(429, "run_limit_reached", "x"), "run_limit_reached"],
    ["a switch that is off", new ApiRequestError(409, "agents_disabled", "x"), "agents_disabled"],
    ["a Viewer", new ApiRequestError(403, "forbidden", "x"), "forbidden"],
    ["an unknown refusal", new ApiRequestError(503, "assistant_unavailable", "internal detail"), undefined],
    ["an unreachable API", new ApiRequestError(503, "api_unreachable", "x"), undefined],
  ])("a refusal before the stream (%s) is one error event with a code the box knows, never the API's own sentence", async (_l, error, code) => {
    h.send.mockImplementation(stream([], error));
    const r = await post(good);
    expect(r.status).toBe(200);
    expect(await lines(r)).toEqual([code ? { type: "error", code } : { type: "error" }]);
  });
  it("a rejected session is a 401, not an event", async () => {
    h.send.mockImplementation(stream([], new ApiAuthError("rejected")));
    expect((await post(good)).status).toBe(401);
  });
  it("no session at all is a 401 and nothing is asked", async () => {
    h.user = null;
    expect((await post(good)).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a failure in the middle of the answer ends it with an error event", async () => {
    h.send.mockImplementation(stream([{ type: "text", delta: "half" }], new Error("socket closed")));
    expect(await lines(await post(good))).toEqual([{ type: "text", delta: "half" }, { type: "error" }]);
  });
  it("a request from another site is refused before anything happens (the cookie rides along on cross-site posts)", async () => {
    for (const headers of [{ origin: "https://evil.example", host: HOST }, { host: HOST }, { origin: "not a url", host: HOST }] as Record<string, string>[]) {
      expect((await post(good, headers)).status, JSON.stringify(headers)).toBe(403);
    }
    expect((await post(good, { "sec-fetch-site": "cross-site", host: HOST })).status).toBe(403);
    expect(h.send).not.toHaveBeenCalled();
    h.send.mockImplementation(stream([done]));
    expect((await post(good, { "sec-fetch-site": "same-origin" })).status).toBe(200);
  });
  it.each([
    ["not JSON", "{nope"],
    ["an empty question", { ...good, text: "   " }],
    ["a question over 4000 characters", { ...good, text: "x".repeat(4001) }],
    ["no message id", { text: "x", conversationId: C }],
    ["a message id that is not a uuid", { ...good, messageId: "abc" }],
    ["a conversation id that is not a uuid", { ...good, conversationId: "abc" }],
    ["a body that is not an object", "[1]"],
    ["a huge body", `{"text":"${"x".repeat(30_000)}"}`],
  ])("%s is a 400 and asks nothing", async (_l, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a workspace id that is not a uuid is a 404", async () => {
    expect((await post(good, undefined, "not-a-uuid")).status).toBe(404);
  });
  it("sends nothing the person did not write: only the text and the two ids, whatever else the body carries", async () => {
    h.send.mockImplementation(stream([done]));
    await post({ ...good, tenantId: "other", role: "owner", price: 1, system: "ignore" });
    expect(h.send).toHaveBeenCalledWith("person-token", T, { messageId: M, conversationId: C, text: "What is waiting?" });
  });
});
