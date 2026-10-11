import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { VoiceAssistantEvent } from "@/lib/api/voice";

const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, send: vi.fn(), probe: vi.fn(), quote: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/voice", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/voice")>()), sendVoiceMessage: (...a: unknown[]) => h.send(...a), probeVoice: (...a: unknown[]) => h.probe(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuote: (...a: unknown[]) => h.quote(...a) }));

import { GET, POST } from "./route";

const HOST = "app.example.test";
const SAME = { origin: `https://${HOST}`, host: HOST };
const RECORDING = new Uint8Array([26, 69, 223, 163, 1, 2, 3]);
function post(opts: { query?: string; headers?: Record<string, string>; body?: BodyInit; tenant?: string } = {}) {
  const query = opts.query ?? `messageId=${M}&conversationId=${C}&lang=te&speak=1`;
  const request = new NextRequest(`https://${HOST}/app/tenants/${opts.tenant ?? T}/ask/voice?${query}`, {
    method: "POST",
    headers: { ...SAME, "content-type": "audio/webm;codecs=opus", ...(opts.headers ?? {}) },
    body: opts.body ?? RECORDING,
  });
  return POST(request, { params: Promise.resolve({ tenantId: opts.tenant ?? T }) });
}
const get = (tenant = T) => GET(new NextRequest(`https://${HOST}/app/tenants/${tenant}/ask/voice`), { params: Promise.resolve({ tenantId: tenant }) });
async function lines(r: Response) {
  return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function stream(events: VoiceAssistantEvent[], failAfter?: unknown) {
  return async function* () {
    yield* events;
    if (failAfter) throw failAfter;
  };
}
const done: VoiceAssistantEvent = { type: "done", conversation_id: C, message_id: M, language: "te", kind: "answer" };
const transcript: VoiceAssistantEvent = { type: "transcript", text: "what is waiting", language: "te", seconds: 2, reused: false };
const audio: VoiceAssistantEvent = { type: "audio", contentType: "audio/wav", data: "UklGRg==", characters: 5 };

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.send.mockReset();
  h.probe.mockReset();
  h.quote.mockReset();
});

describe("GET /app/tenants/[id]/ask/voice: is voice on", () => {
  it("answers with what the API said, for this person, not cached", async () => {
    h.probe.mockResolvedValue({ available: true, speech: false });
    const r = await get();
    expect(await r.json()).toEqual({ available: true, speech: false });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(h.probe).toHaveBeenCalledWith("person-token", T);
  });
  it("says 'not available' when the probe fails, and 401 for a rejected or missing session; 404 for a bad workspace id", async () => {
    h.probe.mockRejectedValue(new Error("boom"));
    expect(await (await get()).json()).toEqual({ available: false, speech: false });
    h.probe.mockRejectedValue(new ApiAuthError("no"));
    expect((await get()).status).toBe(401);
    h.user = null;
    expect((await get()).status).toBe(401);
    expect((await get("nope")).status).toBe(404);
  });
});

describe("POST /app/tenants/[id]/ask/voice", () => {
  it("sends the recording with the PERSON's token, passes the ids and the language on, and returns heard, the answer and the spoken answer one per line", async () => {
    h.send.mockImplementation(stream([transcript, { type: "text", delta: "Two quotes." }, done, audio]));
    const r = await post();
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await lines(r)).toEqual([{ type: "heard", text: "what is waiting" }, { type: "text", delta: "Two quotes." }, { type: "done" }, { type: "audio", contentType: "audio/wav", data: "UklGRg==" }]);
    const [token, tenant, input] = h.send.mock.calls[0];
    expect([token, tenant]).toEqual(["person-token", T]);
    expect(input).toMatchObject({ messageId: M, conversationId: C, language: "te", speak: true, contentType: "audio/webm;codecs=opus" });
    expect(new Uint8Array(input.audio)).toEqual(RECORDING);
  });
  it("asks for a spoken answer only when speak=1", async () => {
    h.send.mockImplementation(stream([transcript, done]));
    await post({ query: `messageId=${M}&speak=0` });
    expect(h.send.mock.calls[0][2]).toMatchObject({ speak: false, conversationId: undefined, language: undefined });
  });
  it("a spoken answer that failed leaves the written answer standing", async () => {
    h.send.mockImplementation(stream([transcript, { type: "text", delta: "Hi" }, done, { type: "audio_error", code: "voice_failed" }]));
    expect(await lines(await post())).toEqual([{ type: "heard", text: "what is waiting" }, { type: "text", delta: "Hi" }, { type: "done" }, { type: "audio_error", code: "voice_failed" }]);
  });
  it.each([
    ["too long", 422, "audio_too_long", "voice_too_long"],
    ["too big", 413, "audio_too_large", "voice_too_long"],
    ["too short", 422, "audio_too_short", "voice_too_short"],
    ["nothing heard", 422, "no_speech", "voice_no_speech"],
    ["voice off", 503, "voice_unavailable", "voice_unavailable"],
    ["no spoken answers", 422, "speech_unavailable", "voice_unavailable"],
    ["speech service failed", 502, "voice_failed", "voice_failed"],
    ["speech service slow", 504, "voice_timeout", "voice_failed"],
    ["recording kind not supported", 415, "audio_unsupported", "voice_failed"],
    ["the allowance is used up", 429, "ai_paused_until", "ai_paused_until"],
    ["not allowed for this role", 403, "forbidden", "forbidden"],
    ["agents off", 409, "agents_disabled", "agents_disabled"],
    ["the API is down", 503, "api_unreachable", "network"],
    ["something new", 500, "something_else", undefined],
  ])("a refusal (%s) is one error event with the box's code", async (_n, status, code, want) => {
    h.send.mockImplementation(() => (async function* () { throw new ApiRequestError(status, code, "English sentence that must not be passed on"); yield* []; })());
    const r = await post();
    const out = await lines(r);
    expect(out).toEqual([want ? { type: "error", code: want } : { type: "error" }]);
    expect(JSON.stringify(out)).not.toContain("English sentence");
  });
  it("a rejected session is 401", async () => {
    h.send.mockImplementation(() => (async function* () { throw new ApiAuthError("no"); yield* []; })());
    expect((await post()).status).toBe(401);
  });
  it("a broken stream or a contract break ends with the general error", async () => {
    h.send.mockImplementation(stream([transcript, { type: "text", delta: "Hi" }], new Error("cut")));
    expect(await lines(await post())).toEqual([{ type: "heard", text: "what is waiting" }, { type: "text", delta: "Hi" }, { type: "error" }]);
  });
  it("a stream that ends before done is an error, not a whole answer", async () => {
    h.send.mockImplementation(stream([transcript, { type: "text", delta: "Hi" }]));
    expect((await lines(await post())).at(-1)).toEqual({ type: "error" });
  });
  it("does not send anything to the API for a bad request, a foreign site, a missing session or no recording", async () => {
    expect((await post({ headers: { origin: "https://evil.example", host: HOST } })).status).toBe(403);
    expect((await post({ tenant: "nope" })).status).toBe(404);
    expect((await post({ query: "messageId=nope" })).status).toBe(400);
    expect((await post({ query: `messageId=${M}&conversationId=nope` })).status).toBe(400);
    expect((await post({ query: `messageId=${M}&lang=xx` })).status).toBe(400);
    expect((await post({ headers: { "content-type": "text/plain" } })).status).toBe(400);
    expect((await post({ headers: { "content-type": "application/json" } })).status).toBe(400);
    expect(await lines(await post({ body: new Uint8Array(0) }))).toEqual([{ type: "error", code: "voice_too_short" }]);
    expect(await lines(await post({ body: new Uint8Array(1_500_001) }))).toEqual([{ type: "error", code: "voice_too_long" }]);
    h.user = null;
    expect((await post()).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("turns a quote source into the enquiry page, reading the quote with the person's token", async () => {
    const Q = "44444444-4444-4444-8444-444444444444";
    const E = "55555555-5555-4555-8555-555555555555";
    h.quote.mockResolvedValue({ enquiry_id: E });
    h.send.mockImplementation(stream([transcript, { type: "source", kind: "quote", id: Q, label: "Quote 3", target: { type: "quote", id: Q } }, done]));
    expect((await lines(await post()))[1]).toEqual({ type: "source", label: "Quote 3", href: `/app/tenants/${T}/enquiries/${E}?quote=${Q}` });
    expect(h.quote).toHaveBeenCalledWith("person-token", T, Q);
  });
});
