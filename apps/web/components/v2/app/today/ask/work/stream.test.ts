import { describe, expect, it } from "vitest";

import { SECRET_JSON } from "@/lib/assistant-work/fixtures";

import { makeAskTransport, parseLine } from "../transport";

describe("the chat's stream and the work cards", () => {
  it("reads a work_card line as the raw card (the session parses it strictly); a card that is not an object is dropped", () => {
    expect(parseLine(JSON.stringify({ type: "work_card", card: SECRET_JSON }))).toEqual({ type: "work_card", card: SECRET_JSON });
    expect(parseLine(JSON.stringify({ type: "work_card", card: "x" }))).toBeNull();
    expect(parseLine(JSON.stringify({ type: "work_card" }))).toBeNull();
  });
  it("sends the upload ids with the question only when there are some", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('{"type":"done"}\n', { headers: { "content-type": "application/x-ndjson" } });
    }) as unknown as typeof fetch;
    const ask = makeAskTransport("/ask", fetcher);
    for await (const _ of ask({ question: "add", lang: "en", signal: new AbortController().signal, attachmentIds: ["b2000000-0000-4000-8000-000000000001"] })) void _;
    for await (const _ of ask({ question: "hi", lang: "en", signal: new AbortController().signal, attachmentIds: [] })) void _;
    expect(bodies[0].attachmentIds).toEqual(["b2000000-0000-4000-8000-000000000001"]);
    expect("attachmentIds" in bodies[1]).toBe(false);
  });
});
