import { describe, expect, it } from "vitest";

import { parseConversationPage, parseThread } from "@/lib/api/whatsapp";

import { assistantOn, chatHandling, CHAT_FILTERS, filterCounts, inFilter, parseChatFilter, sentByAssistant } from "./handling";

const L = "11111111-aaaa-4aaa-8aaa-000000000001";
const conv = (over: Record<string, unknown> = {}) =>
  parseConversationPage({ conversations: [{ lead_id: L, name: "Ravi", company: null, last_at: "2026-11-12T10:00:00Z", last_direction: "in", preview: "Hi", window_open: true, window_expires_at: null, unread: true, stopped: false, ...over }], next_before: null }).conversations[0];

describe("who is handling a chat", () => {
  it("a reply waiting for the owner's OK is 'reply ready', whatever else is true", () => {
    expect(chatHandling(conv(), true)).toEqual({ state: "reply_ready", outcome: null });
    expect(chatHandling(conv({ reply_ready: true, last_direction: "out" }), false).state).toBe("reply_ready");
    expect(chatHandling(conv({ stopped: true }), true).state).toBe("reply_ready");
  });
  it("a customer who asked us to stop is done", () => {
    expect(chatHandling(conv({ stopped: true }), false).state).toBe("done");
  });
  it("C1's handled_by wins over what the list shows", () => {
    expect(chatHandling(conv({ handled_by: "needs_you", last_direction: "out" }), false).state).toBe("needs_you");
    expect(chatHandling(conv({ handled_by: "assistant", last_direction: "in" }), false).state).toBe("assistant");
    expect(chatHandling(conv({ handled_by: "owner", outcome: "visit_booked" }), false)).toEqual({ state: "done", outcome: "visit_booked" });
    expect(chatHandling(conv({ handled_by: "done", last_direction: "in" }), false).state).toBe("done"); // C1's word for a chat a person finished
  });
  it("an outcome word closes the chat and is kept for the row to say", () => {
    expect(chatHandling(conv({ outcome: "quote_sent" }), false)).toEqual({ state: "done", outcome: "quote_sent" });
    expect(conv({ outcome: "Not A Word!" }).outcome).toBeNull();
  });
  it("without the API's words: the customer wrote last = needs you; we wrote last = answered by the assistant", () => {
    expect(chatHandling(conv({ last_direction: "in" }), false).state).toBe("needs_you");
    expect(chatHandling(conv({ last_direction: "out" }), false).state).toBe("assistant");
    expect(chatHandling(conv({ last_direction: "in", assistant_enabled: false }), false).state).toBe("needs_you");
  });
  it("an odd handled_by is ignored", () => {
    expect(conv({ handled_by: "robot" }).handledBy).toBeNull();
  });
});

describe("the filters", () => {
  it("'Needs you' holds both the waiting replies and the unanswered chats; the others hold their own", () => {
    expect(inFilter("reply_ready", "needs_you")).toBe(true);
    expect(inFilter("needs_you", "needs_you")).toBe(true);
    expect(inFilter("assistant", "needs_you")).toBe(false);
    expect(inFilter("assistant", "assistant")).toBe(true);
    expect(inFilter("done", "done")).toBe(true);
    expect(inFilter("done", "all")).toBe(true);
  });
  it("counts each filter", () => {
    expect(filterCounts(["reply_ready", "needs_you", "assistant", "assistant", "done"])).toEqual({ all: 5, needs_you: 2, assistant: 2, done: 1 });
    expect(Object.keys(filterCounts([]))).toEqual([...CHAT_FILTERS]);
  });
  it("reads the filter from the address, defaulting to all", () => {
    expect(parseChatFilter("done")).toBe("done");
    expect(parseChatFilter(["assistant", "x"])).toBe("assistant");
    expect(parseChatFilter("bogus")).toBe("all");
    expect(parseChatFilter(undefined)).toBe("all");
  });
});

describe("the bubbles and the switch", () => {
  const item = (over: Record<string, unknown>) => parseThread({ lead_id: L, name: null, stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: null, next_before: null, items: [{ direction: "out", id: L, at: "2026-11-12T10:00:00Z", text: "Hello", status: "sent", ...over }] }).items[0];
  it("an outgoing message is the assistant's unless the API says the owner wrote it; incoming is never", () => {
    expect(sentByAssistant(item({}))).toBe(true);
    expect(sentByAssistant(item({ by: "assistant" }))).toBe(true);
    expect(sentByAssistant(item({ by: "owner" }))).toBe(false);
    expect(sentByAssistant(item({ by: "robot" }))).toBe(true);
    expect(sentByAssistant({ direction: "in", by: null })).toBe(false);
  });
  it("the switch: the owner's cookie wins, then the API, then on", () => {
    expect(assistantOn(null, [], L)).toBe(true);
    expect(assistantOn(false, [], L)).toBe(false);
    expect(assistantOn(true, [L], L)).toBe(false);
    expect(assistantOn(undefined, ["x"], L)).toBe(true);
  });
  it("the thread reads the switch if the API sends it", () => {
    expect(parseThread({ lead_id: L, name: null, stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: null, next_before: null, items: [], assistant_enabled: false }).assistantEnabled).toBe(false);
  });
});
