import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.fn();
const request = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiStreamRequest: (...a: unknown[]) => stream(...a), apiRequest: (...a: unknown[]) => request(...a) }));
vi.mock("./assistant", async (orig) => ({ ...(await orig<typeof import("./assistant")>()), readSse: async function* () { yield* events; } }));

import { ApiContractError } from "./client";
import { archiveConversation, confirmAction, getHistory, listConversations, parseConfirmAction, parseTurnEvent, sendTurn } from "./turns";

const T = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";
const PLAN = { type: "confirm_action", action_id: A, title: "Call 12 new leads", summary: "Today, in calling hours.", steps: ["Pick the new leads", "Call each one"], count: 12, channel: "call", estimate: { messages: 0, call_minutes: 30, cost_paise: 1200 }, needs_second_factor: true, expires_at: "2026-10-28T20:00:00Z" };
let events: { name: string; data: unknown }[] = [];
beforeEach(() => {
  stream.mockReset().mockResolvedValue({ body: {} });
  request.mockReset();
  events = [];
});

describe("a conversation turn's events", () => {
  it("reads the plan to confirm (a proposed plan by default; a standing rule's comes already confirmed) and refuses a malformed one", () => {
    expect(parseTurnEvent("confirm_action", PLAN)).toMatchObject({ type: "confirm_action", action: { actionId: A, title: "Call 12 new leads", count: 12, channel: "call", status: "proposed", needsSecondFactor: true, estimate: { messages: 0, callMinutes: 30, costPaise: 1200 }, steps: ["Pick the new leads", "Call each one"] } });
    expect(parseConfirmAction({ ...PLAN, status: "confirmed" }).status).toBe("confirmed");
    expect(parseConfirmAction({ ...PLAN, estimate: null, count: null, channel: null }).estimate).toBeNull();
    for (const bad of [{ ...PLAN, action_id: "x" }, { ...PLAN, channel: "sms" }, { ...PLAN, steps: "a" }, { ...PLAN, status: "weird" }, { ...PLAN, count: -1 }]) expect(() => parseConfirmAction(bad)).toThrow(ApiContractError);
  });
  it("reads the router's decision, the one short question, and a source whose screen is `open` or `target`; a source of an unknown kind is left out", () => {
    expect(parseTurnEvent("intent", { type: "intent", kind: "general" })).toEqual({ type: "intent", kind: "general" });
    expect(parseTurnEvent("intent", { type: "intent", kind: "odd" })).toBeNull();
    expect(parseTurnEvent("clarify", { type: "clarify", question: "Which leads?", action_id: A })).toEqual({ type: "clarify", question: "Which leads?", actionId: A });
    const src = { type: "source", kind: "lead", id: A, label: "Ramesh" };
    expect(parseTurnEvent("source", { ...src, open: { type: "lead", id: A } })).toMatchObject({ type: "source", label: "Ramesh", target: { type: "lead", id: A } });
    expect(parseTurnEvent("source", { ...src, target: { type: "lead", id: A } })).toMatchObject({ target: { type: "lead", id: A } });
    expect(parseTurnEvent("source", { ...src, kind: "newer_kind" })).toBeNull();
    expect(parseTurnEvent("done", { type: "done", conversation_id: A, message_id: M, language: "te", kind: "confirm_action" })).toMatchObject({ type: "done", kind: "confirm_action", conversation_id: A });
    expect(() => parseTurnEvent("clarify", { type: "other" })).toThrow(ApiContractError);
  });
  it("sends the turn with a null conversation to start one, only plain ids and text, and yields what the stream says", async () => {
    events = [{ name: "intent", data: { type: "intent", kind: "action" } }, { name: "confirm_action", data: PLAN }, { name: "done", data: { type: "done", conversation_id: A, message_id: M, language: "en", kind: "confirm_action" } }];
    const got: string[] = [];
    for await (const e of sendTurn("tok", T, { messageId: M, conversationId: null, text: "  call the new leads  ", languageHint: "en" })) got.push(e.type);
    expect(got).toEqual(["intent", "confirm_action", "done"]);
    expect(stream).toHaveBeenCalledWith(`/v1/tenants/${T}/assistant/turns`, "tok", { message_id: M, conversation_id: null, text: "call the new leads", language_hint: "en" });
    for await (const _ of sendTurn("tok", T, { messageId: M, conversationId: null, text: "price?", language: "te" })) void _;
    expect(stream).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/turns`, "tok", { message_id: M, conversation_id: null, text: "price?", language_hint: null, language: "te" }); // the pill: the reply is in that language
    await expect((async () => { for await (const _ of sendTurn("tok", T, { messageId: "x", conversationId: null, text: "hi" })) void _; })()).rejects.toBeInstanceOf(ApiContractError);
    await expect((async () => { for await (const _ of sendTurn("tok", T, { messageId: M, conversationId: null, text: "" })) void _; })()).rejects.toBeInstanceOf(ApiContractError);
  });
});

describe("history and the plan's answer", () => {
  it("lists the person's conversations, reads one with its action state, hides one, and confirms or declines a plan", async () => {
    request.mockResolvedValueOnce({ items: [{ id: A, title: "Price of silk", updated_at: "2026-10-28T10:00:00Z", message_count: 4, last_text: "Rs 500" }], next_before: null });
    expect(await listConversations("tok", T)).toEqual({ items: [{ id: A, title: "Price of silk", updatedAt: "2026-10-28T10:00:00Z", messageCount: 4, lastText: "Rs 500" }], nextBefore: null });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/conversations?limit=30`, "tok");
    request.mockResolvedValueOnce({ messages: [{ id: M, role: "user", text: "call the new leads", created_at: "x" }, { id: A, role: "assistant", text: "I will call 12.", kind: "confirm_action", action: { action_id: A, status: "proposed" }, sources: [], created_at: "x" }] });
    const h = await getHistory("tok", T, A);
    expect(h[1]).toMatchObject({ role: "assistant", kind: "confirm_action", action: { actionId: A, status: "proposed" } });
    request.mockResolvedValueOnce(null);
    await archiveConversation("tok", T, A);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/conversations/${A}/archive`, "tok", { method: "POST", body: "{}" });
    request.mockResolvedValueOnce({ action_id: A, status: "confirmed", task: { id: M, status: "approved" } });
    expect(await confirmAction("tok", T, A, "yes")).toEqual({ status: "confirmed" });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/actions/${A}/confirm`, "tok", { method: "POST", body: JSON.stringify({ decision: "yes" }) });
    request.mockResolvedValueOnce({ status: "weird" });
    await expect(confirmAction("tok", T, A, "no")).rejects.toBeInstanceOf(ApiContractError);
    await expect(getHistory("tok", T, "x")).rejects.toBeInstanceOf(ApiContractError);
  });
});
