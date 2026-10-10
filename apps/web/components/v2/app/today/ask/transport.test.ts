import { describe, expect, it, vi } from "vitest";

import type { AskEvent } from "./ask-types";
import { makeAskTransport, parseLine } from "./transport";

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
