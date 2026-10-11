import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError } from "./client";
import { MAX_RECORDING_BYTES, parseVoiceEvent, probeVoice, sendVoiceMessage, type VoiceAssistantEvent } from "./voice";

const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const sse = (events: [string, unknown][]) => events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const answer = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ error: { code, message: "x", ...extra } }), { status, headers: { "Content-Type": "application/json" } });
const withFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const fn = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
};
afterEach(() => vi.unstubAllGlobals());

const collect = async (g: AsyncGenerator<VoiceAssistantEvent>) => {
  const out: VoiceAssistantEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
};

describe("voice events", () => {
  it("reads the transcript, the audio and the audio error", () => {
    expect(parseVoiceEvent("transcript", { type: "transcript", text: "What needs me today?", language: "en", seconds: 1.5, reused: true })).toEqual({ type: "transcript", text: "What needs me today?", language: "en", seconds: 1.5, reused: true });
    expect(parseVoiceEvent("transcript", { type: "transcript", text: "x", language: "xx", seconds: -3 })).toMatchObject({ language: null, seconds: 0, reused: false });
    expect(parseVoiceEvent("audio", { type: "audio", content_type: "audio/wav; charset=x", encoding: "base64", data: "UklGRg==", characters: 12 })).toEqual({ type: "audio", contentType: "audio/wav", data: "UklGRg==", characters: 12 });
    expect(parseVoiceEvent("audio_error", { type: "audio_error", code: "budget" })).toEqual({ type: "audio_error", code: "budget" });
  });
  it("refuses an audio event that is not base64 audio of a known type, or a transcript that is not text", () => {
    for (const d of [
      { type: "audio", content_type: "text/html", encoding: "base64", data: "AAAA" },
      { type: "audio", content_type: "audio/wav", encoding: "hex", data: "AAAA" },
      { type: "audio", content_type: "audio/wav", encoding: "base64", data: "<script>" },
      { type: "audio", content_type: "audio/wav", encoding: "base64", data: "" },
      { type: "audio", content_type: "audio/wav", encoding: "base64", data: "A".repeat(8_000_001) },
    ])
      expect(() => parseVoiceEvent("audio", d)).toThrow(ApiContractError);
    expect(() => parseVoiceEvent("transcript", { type: "transcript", text: 5 })).toThrow(ApiContractError);
    expect(() => parseVoiceEvent("transcript", { type: "audio", text: "x" })).toThrow(ApiContractError);
  });
  it("hands every other event to the text route's reader", () => {
    expect(parseVoiceEvent("text", { type: "text", delta: "hi" })).toEqual({ type: "text", delta: "hi" });
    expect(() => parseVoiceEvent("nope", { type: "nope" })).toThrow(ApiContractError);
  });
});

describe("sendVoiceMessage", () => {
  const input = { messageId: M, conversationId: C, language: "te" as const, speak: true, audio: new Uint8Array([1, 2, 3]).buffer, contentType: "audio/webm;codecs=opus" };
  it("posts the recording as it is, with the ids in the query, and yields the whole stream in order", async () => {
    const fetched = withFetch(() =>
      answer(
        sse([
          ["transcript", { type: "transcript", text: "hello", language: "te", seconds: 2, reused: false }],
          ["text", { type: "text", delta: "Hi" }],
          ["done", { type: "done", message_id: M, conversation_id: C, language: "te", kind: "answer" }],
          ["audio", { type: "audio", content_type: "audio/wav", encoding: "base64", data: "UklGRg==", characters: 2 }],
        ]),
      ),
    );
    const events = await collect(sendVoiceMessage("tok", T, input));
    expect(events.map((e) => e.type)).toEqual(["transcript", "text", "done", "audio"]);
    const [url, init] = fetched.mock.calls[0];
    expect(url).toContain(`/v1/tenants/${T}/assistant/voice?`);
    const q = new URL(url, "http://x").searchParams;
    expect(Object.fromEntries(q)).toEqual({ message_id: M, speak: "true", conversation_id: C, language: "te" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("audio/webm");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe(input.audio);
  });
  it("speak=false and no language when not asked", async () => {
    const fetched = withFetch(() => answer(""));
    await collect(sendVoiceMessage("tok", T, { messageId: M, speak: false, audio: input.audio, contentType: "audio/mp4" }));
    expect(Object.fromEntries(new URL(fetched.mock.calls[0][0], "http://x").searchParams)).toEqual({ message_id: M, speak: "false" });
  });
  it("refuses a bad id, an empty or too big recording, a non-audio type and an unknown language before anything is sent", async () => {
    const fetched = withFetch(() => answer(""));
    const bads = [
      { ...input, messageId: "nope" },
      { ...input, audio: new ArrayBuffer(0) },
      { ...input, audio: new ArrayBuffer(MAX_RECORDING_BYTES + 1) },
      { ...input, contentType: "text/plain" },
      { ...input, language: "xx" as never },
    ];
    for (const b of bads) await expect(collect(sendVoiceMessage("tok", T, b))).rejects.toThrow(ApiContractError);
    await expect(collect(sendVoiceMessage("tok", "nope", input))).rejects.toThrow(ApiContractError);
    expect(fetched).not.toHaveBeenCalled();
  });
  it("throws the API's refusal before the first event, and an auth error for 401", async () => {
    withFetch(() => refusal(429, "ai_paused_until", { until: "2026-10-12T00:00:00Z" }));
    await expect(collect(sendVoiceMessage("tok", T, input))).rejects.toMatchObject({ status: 429, code: "ai_paused_until", until: "2026-10-12T00:00:00Z" });
    withFetch(() => refusal(422, "no_speech"));
    await expect(collect(sendVoiceMessage("tok", T, input))).rejects.toMatchObject({ status: 422, code: "no_speech" });
    withFetch(() => new Response("", { status: 401 }));
    await expect(collect(sendVoiceMessage("tok", T, input))).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("a contract break in the middle of the stream is an error, not a guess", async () => {
    withFetch(() => answer(sse([["audio", { type: "audio", content_type: "text/html", encoding: "base64", data: "AAAA" }]])));
    await expect(collect(sendVoiceMessage("tok", T, input))).rejects.toThrow(ApiContractError);
  });
});

describe("probeVoice: is voice on, asked of the API with an empty recording", () => {
  const probe = async (res: Response | Error) => {
    const fetched = withFetch(() => {
      if (res instanceof Error) throw res;
      return res;
    });
    const r = await probeVoice("tok", T, M);
    return { r, fetched };
  };
  it.each([
    ["voice is off (503)", refusal(503, "voice_unavailable"), { available: false, speech: false }],
    ["the role may not use it (403)", refusal(403, "forbidden"), { available: false, speech: false }],
    ["it hears but cannot speak (422 speech_unavailable)", refusal(422, "speech_unavailable"), { available: true, speech: false }],
    ["it is on: the empty recording is too short", refusal(422, "audio_too_short"), { available: true, speech: true }],
    ["it is on: unreadable", refusal(422, "audio_unreadable"), { available: true, speech: true }],
    ["it is on: the allowance is used (429)", refusal(429, "ai_paused_until"), { available: true, speech: true }],
    ["a server error is not known, so off", refusal(500, "server_error"), { available: false, speech: false }],
    ["the API is unreachable, so off", new Error("down"), { available: false, speech: false }],
  ] as const)("%s", async (_n, res, want) => {
    expect((await probe(res)).r).toEqual(want);
  });
  it("sends nothing but an empty recording: no audio, no conversation", async () => {
    const { fetched } = await probe(refusal(422, "audio_too_short"));
    const [url, init] = fetched.mock.calls[0];
    expect(Object.fromEntries(new URL(url, "http://x").searchParams)).toEqual({ message_id: M, speak: "true" });
    expect((init.body as ArrayBuffer).byteLength).toBe(0);
  });
  it("passes a rejected session on and refuses a bad workspace id", async () => {
    withFetch(() => new Response("", { status: 401 }));
    await expect(probeVoice("tok", T, M)).rejects.toBeInstanceOf(ApiAuthError);
    await expect(probeVoice("tok", "nope")).rejects.toThrow(ApiContractError);
  });
});
