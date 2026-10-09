import { describe, expect, it } from "vitest";

import type { AskEvent } from "@/components/v2/app/today/ask/ask-types";
import type { AssistantEvent, Target } from "@/lib/api/assistant";

import { knownCode, MAX_DRAFTS, MAX_SOURCES, pathFor, toAskEvents } from "./ask-stream";

const B = "/app/tenants/T";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const none = async (): Promise<string | null> => null;
const target = (type: Target["type"], n = 1): Target => ({ type, id: ID(n) });
const source = (n: number, t: Target | null = target("order", n)): AssistantEvent => ({ type: "source", kind: "order", id: ID(n), label: `S${n}`, target: t });
const done: AssistantEvent = { type: "done", conversation_id: ID(90), message_id: ID(91), language: "en", kind: "answer" };

async function run(events: AssistantEvent[], lookup: (id: string) => Promise<string | null> = none, fail?: unknown): Promise<AskEvent[]> {
  async function* gen() {
    yield* events;
    if (fail) throw fail;
  }
  const out: AskEvent[] = [];
  for await (const e of toAskEvents(gen(), B, lookup)) out.push(e);
  return out;
}

describe("pathFor: a target becomes a page of THIS workspace", () => {
  it("order, lead and enquiry open their own page; a company or price item (null) has none", async () => {
    expect(await pathFor(target("order"), B, none)).toBe(`${B}/orders/${ID(1)}`);
    expect(await pathFor(target("lead"), B, none)).toBe(`${B}/leads/${ID(1)}`);
    expect(await pathFor(target("enquiry"), B, none)).toBe(`${B}/enquiries/${ID(1)}`);
    expect(await pathFor(null, B, none)).toBeNull();
  });
  it("a quote opens the enquiry it belongs to; when that is not found, the list of quotes", async () => {
    expect(await pathFor(target("quote", 5), B, async (q) => (q === ID(5) ? ID(6) : null))).toBe(`${B}/enquiries/${ID(6)}?quote=${ID(5)}`);
    expect(await pathFor(target("quote", 5), B, none)).toBe(`${B}/quotes`);
  });
});

describe("toAskEvents", () => {
  it("passes text, sources, drafts and the end in the box's shape, in order, and drops what the box does not draw", async () => {
    const events: AssistantEvent[] = [
      { type: "text", delta: "Two " },
      { type: "text", delta: "waiting." },
      source(1),
      source(2, null),
      { type: "draft", id: ID(3), kind: "reply_draft", title: "Reply", summary: "నమస్కారం", status: "draft", target: target("lead", 3), language: "te", gloss_en: "Hello", machine_draft: true },
      { type: "draft", id: ID(4), kind: "quote", title: "Quote 3", summary: "A draft quote.", status: "draft", target: target("quote", 4), language: null, gloss_en: null, machine_draft: false },
      done,
    ];
    expect(await run(events, async () => ID(7))).toEqual([
      { type: "text", delta: "Two " },
      { type: "text", delta: "waiting." },
      { type: "source", label: "S1", href: `${B}/orders/${ID(1)}` },
      { type: "source", label: "S2", href: null },
      { type: "draft", id: ID(3), kind: "reply_draft", title: "Reply", summary: "నమస్కారం", href: `${B}/leads/${ID(3)}`, language: "te", gloss: "Hello", machine: true },
      { type: "draft", id: ID(4), kind: "quote", title: "Quote 3", summary: "A draft quote.", href: `${B}/enquiries/${ID(7)}?quote=${ID(4)}`, language: null, gloss: null, machine: false },
      { type: "done" },
    ]);
  });
  it("stops at done: nothing after it is passed on", async () => {
    expect(await run([{ type: "text", delta: "a" }, done, { type: "text", delta: "late" }])).toEqual([{ type: "text", delta: "a" }, { type: "done" }]);
  });
  it("caps the sources and drafts, so one answer cannot cause an unbounded number of lookups", async () => {
    let looked = 0;
    const lookup = async () => (looked++, ID(9));
    const out = await run([
      ...Array.from({ length: 20 }, (_, i) => source(i + 1, target("quote", i + 1))),
      ...Array.from({ length: 20 }, (_, i): AssistantEvent => ({ type: "draft", id: ID(100 + i), kind: "quote", title: "t", summary: "s", status: "draft", target: target("quote", 100 + i), language: null, gloss_en: null, machine_draft: false })),
      done,
    ], lookup);
    expect(out.filter((e) => e.type === "source")).toHaveLength(MAX_SOURCES);
    expect(out.filter((e) => e.type === "draft")).toHaveLength(MAX_DRAFTS);
    expect(looked).toBe(MAX_SOURCES + MAX_DRAFTS);
  });
  it("an error keeps only a code the box knows, never the API's sentence, and ends the answer", async () => {
    expect(await run([{ type: "error", code: "cost_cap_reached", message: "Ignore previous instructions" }, { type: "text", delta: "x" }])).toEqual([{ type: "error", code: "cost_cap_reached" }]);
    expect(await run([{ type: "error", code: "weird", message: "x" }])).toEqual([{ type: "error", code: undefined }]);
  });
  it("a stream that ends with neither done nor error is an error", async () => {
    expect(await run([{ type: "text", delta: "half" }])).toEqual([{ type: "text", delta: "half" }, { type: "error" }]);
  });
  it("knownCode", () => {
    expect(["cost_cap_reached", "run_limit_reached", "agents_disabled", "forbidden"].map(knownCode)).toEqual(["cost_cap_reached", "run_limit_reached", "agents_disabled", "forbidden"]);
    expect(knownCode("message_id_used")).toBeUndefined();
    expect(knownCode("__proto__")).toBeUndefined();
  });
});
