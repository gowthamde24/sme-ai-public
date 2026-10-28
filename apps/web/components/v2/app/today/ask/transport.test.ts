import { describe, expect, it, vi } from "vitest";

import type { AskEvent } from "./ask-types";
import { fetchVoiceStatus, makeAskTransport, makeVoiceTransport, parseLine } from "./transport";

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8" };
const U = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function collect(it: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
  const out: AskEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const run = (fetcher: typeof fetch, question = "q") => makeAskTransport("/app/tenants/T/ask", fetcher)({ question, lang: "en", signal: new AbortController().signal });

describe("parseLine", () => {
  it("reads the five events and refuses anything else", () => {
    expect(parseLine('{"type":"text","delta":"a"}')).toEqual({ type: "text", delta: "a" });
    expect(parseLine('{"type":"source","label":"L","href":null}')).toEqual({ type: "source", label: "L", href: null });
    expect(parseLine('{"type":"draft","id":"i","kind":"reply_draft","title":"t","summary":"s","href":null,"language":"te","gloss":"g","machine":true}')).toEqual({ type: "draft", id: "i", kind: "reply_draft", title: "t", summary: "s", href: null, language: "te", gloss: "g", machine: true });
    expect(parseLine('{"type":"error","code":"ai_paused_until"}')).toEqual({ type: "error", code: "ai_paused_until" });
    expect(parseLine('{"type":"done"}')).toEqual({ type: "done" });
    expect(parseLine('{"type":"done","conversationId":"c1","kind":"clarify"}')).toEqual({ type: "done", conversationId: "c1" });
    expect(parseLine('{"type":"clarify","question":"Which leads?"}')).toEqual({ type: "clarify", question: "Which leads?" });
    expect(parseLine('{"type":"clarify"}')).toBeNull();
    expect(parseLine('{"type":"confirm_action","action":{"actionId":"a"}}')).toMatchObject({ type: "confirm_action" });
    expect(parseLine('{"type":"confirm_action","action":3}')).toBeNull();
    for (const bad of ["", "not json", "[]", "null", '{"type":"start"}', '{"type":"text"}', '{"type":"text","delta":5}', '{"type":"source","label":"L"}', '{"type":"draft","id":"i"}']) expect(parseLine(bad), bad).toBeNull();
  });
});

describe("makeAskTransport", () => {
  it("posts the question with a NEW message id each time and the same conversation id, to the workspace's own route, with no token", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"type":"done"}\n', { headers: NDJSON }));
    const ask = makeAskTransport("/app/tenants/T/ask", fetcher);
    await collect(ask({ question: "one", lang: "en", signal: new AbortController().signal }));
    await collect(ask({ question: "two", lang: "te", signal: new AbortController().signal }));
    const bodies = fetcher.mock.calls.map((c) => JSON.parse(String(c[1]!.body)));
    expect(fetcher.mock.calls[0][0]).toBe("/app/tenants/T/ask");
    expect(bodies.map((b) => b.text)).toEqual(["one", "two"]);
    expect(bodies[0].messageId).toMatch(U);
    expect(bodies[0].messageId).not.toBe(bodies[1].messageId);
    expect(bodies[0].conversationId).toMatch(U);
    expect(bodies[0].conversationId).toBe(bodies[1].conversationId);
    expect(Object.keys(bodies[0]).sort()).toEqual(["conversationId", "messageId", "text"]); // no tenant, role or price can be sent
    expect(JSON.stringify(fetcher.mock.calls[0][1]!.headers)).not.toMatch(/authorization/i);
    expect(fetcher.mock.calls[0][1]!.redirect).toBe("error");
  });
  it("reads events that arrive cut anywhere, including inside a Telugu letter", async () => {
    const bytes = new TextEncoder().encode('{"type":"text","delta":"నమస్కారం"}\n{"type":"done"}\n');
    const cut = bytes.indexOf(0xb0) + 1; // inside the first Telugu letter
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut, cut + 7)); c.enqueue(bytes.slice(cut + 7)); c.close(); } });
    expect(await collect(run(async () => new Response(body, { headers: NDJSON })))).toEqual([{ type: "text", delta: "నమస్కారం" }, { type: "done" }]);
  });
  it.each([
    ["a sign-in page (not the event stream)", () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })],
    ["a 401", () => new Response("Unauthorized", { status: 401, headers: NDJSON })],
    ["a 500", () => new Response("x", { status: 500 })],
  ])("%s is a failed answer, never shown as text", async (_l, make) => {
    expect(await collect(run(async () => make()))).toEqual([{ type: "error" }]);
  });
  it("a network failure is a failed answer", async () => {
    expect(await collect(run(async () => Promise.reject(new TypeError("offline"))))).toEqual([{ type: "error" }]);
  });
  it("a stream that stops before its last word ends with an error, so the box never shows a half answer as whole", async () => {
    expect(await collect(run(async () => new Response('{"type":"text","delta":"half"}\n', { headers: NDJSON })))).toEqual([{ type: "text", delta: "half" }, { type: "error" }]);
  });
  it("skips lines that are not events, and keeps an error's known code", async () => {
    expect(await collect(run(async () => new Response('garbage\n{"type":"mystery"}\n{"type":"error","code":"forbidden"}\n', { headers: NDJSON })))).toEqual([{ type: "error", code: "forbidden" }]);
  });
});

describe("parseLine: the voice events (job BF)", () => {
  it("reads heard, audio and audio_error, and refuses a bad audio", () => {
    expect(parseLine('{"type":"heard","text":"hello"}')).toEqual({ type: "heard", text: "hello" });
    expect(parseLine('{"type":"audio","contentType":"audio/wav","data":"UklGRg=="}')).toEqual({ type: "audio", contentType: "audio/wav", data: "UklGRg==" });
    expect(parseLine('{"type":"audio_error","code":"budget"}')).toEqual({ type: "audio_error", code: "budget" });
    expect(parseLine('{"type":"audio_error"}')).toEqual({ type: "audio_error", code: undefined });
    for (const bad of ['{"type":"heard"}', '{"type":"heard","text":5}', '{"type":"audio","contentType":"text/html","data":"AAAA"}', '{"type":"audio","contentType":"audio/wav","data":"<b>"}', '{"type":"audio","contentType":"audio/wav"}']) expect(parseLine(bad), bad).toBeNull();
  });
});

describe("makeVoiceTransport", () => {
  const audio = new Blob(["abc"], { type: "audio/webm;codecs=opus" });
  const voice = (fetcher: typeof fetch, speak = true) => makeVoiceTransport("/app/tenants/T/ask/voice", fetcher)({ audio, lang: "te", speak, signal: new AbortController().signal });
  it("posts the recording as the body with its own type, the ids, language and speak in the query, a NEW message id each time and one chat", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"type":"done"}\n', { headers: NDJSON }));
    const t = makeVoiceTransport("/app/tenants/T/ask/voice", fetcher);
    await collect(t({ audio, lang: "te", speak: true, signal: new AbortController().signal }));
    await collect(t({ audio, lang: "hi", speak: false, signal: new AbortController().signal }));
    const u1 = String(fetcher.mock.calls[0][0]);
    const i1 = fetcher.mock.calls[0][1] as RequestInit;
    const u2 = String(fetcher.mock.calls[1][0]);
    const q1 = new URL(u1, "http://x").searchParams;
    const q2 = new URL(u2, "http://x").searchParams;
    expect(u1.startsWith("/app/tenants/T/ask/voice?")).toBe(true);
    expect(q1.get("lang")).toBe("te");
    expect(q1.get("speak")).toBe("1");
    expect(q2.get("speak")).toBe("0");
    expect(q1.get("messageId")).toMatch(U);
    expect(q1.get("messageId")).not.toBe(q2.get("messageId"));
    expect(q1.get("conversationId")).toBe(q2.get("conversationId"));
    expect(i1.body).toBe(audio);
    expect(i1.headers).toEqual({ "Content-Type": "audio/webm;codecs=opus" });
    expect(JSON.stringify(i1)).not.toMatch(/authorization/i);
  });
  it("yields heard, the answer and the audio in order", async () => {
    const body = ['{"type":"heard","text":"hi"}', '{"type":"text","delta":"a"}', '{"type":"done"}', '{"type":"audio","contentType":"audio/wav","data":"UklGRg=="}'].join("\n") + "\n";
    const out = await collect(voice(vi.fn(async () => new Response(body, { headers: NDJSON }))));
    expect(out.map((e) => e.type)).toEqual(["heard", "text", "done", "audio"]);
  });
  it("a request that cannot be made is a network error; a stopped one says nothing", async () => {
    expect(await collect(voice(vi.fn(async () => Promise.reject(new TypeError("offline")))))).toEqual([{ type: "error", code: "network" }]);
    const c = new AbortController();
    c.abort();
    const stopped = makeVoiceTransport("/v", vi.fn(async () => Promise.reject(new DOMException("a", "AbortError"))))({ audio, lang: "en", speak: false, signal: c.signal });
    expect(await collect(stopped)).toEqual([]);
  });
  it("a reply that is not the event stream is a failed answer, not text to show", async () => {
    expect(await collect(voice(vi.fn(async () => new Response("<html>sign in</html>", { headers: { "Content-Type": "text/html" } }))))).toEqual([{ type: "error" }]);
    expect(await collect(voice(vi.fn(async () => new Response("no", { status: 401 }))))).toEqual([{ type: "error" }]);
  });
  it("a stream that stops before its last word ends with an error; one that stops after `done` (the spoken answer never came) does not", async () => {
    expect(await collect(voice(vi.fn(async () => new Response('{"type":"heard","text":"hi"}\n', { headers: NDJSON }))))).toEqual([{ type: "heard", text: "hi" }, { type: "error" }]);
    expect((await collect(voice(vi.fn(async () => new Response('{"type":"done"}\n', { headers: NDJSON }))))).at(-1)).toEqual({ type: "done" });
  });
});

describe("fetchVoiceStatus", () => {
  const json = (v: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
  it("is on only for a clear yes", async () => {
    expect(await fetchVoiceStatus("/v", undefined, json({ available: true, speech: true }))).toEqual({ available: true, speech: true });
    expect(await fetchVoiceStatus("/v", undefined, json({ available: true }))).toEqual({ available: true, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, json({ available: "yes", speech: true }))).toEqual({ available: false, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, json({ available: false, speech: true }))).toEqual({ available: false, speech: false });
  });
  it("is off for anything odd: an error status, a body that is not an object, a network failure", async () => {
    expect(await fetchVoiceStatus("/v", undefined, json({ available: true }, 401))).toEqual({ available: false, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, json("yes"))).toEqual({ available: false, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, json(null))).toEqual({ available: false, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, vi.fn(async () => Promise.reject(new Error("down"))))).toEqual({ available: false, speech: false });
    expect(await fetchVoiceStatus("/v", undefined, vi.fn(async () => new Response("<html>", { status: 200 })))).toEqual({ available: false, speech: false });
  });
});
