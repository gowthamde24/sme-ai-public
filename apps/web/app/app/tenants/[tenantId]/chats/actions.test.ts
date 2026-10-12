import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/outbox", async (orig) => {
  const real = await orig<typeof import("@/lib/api/outbox")>();
  const wrap = (n: string) => (...a: unknown[]) => h.api(n, ...a);
  return { ...real, submitOutboxMessage: wrap("submit"), approveOutboxMessage: wrap("approve"), rejectOutboxMessage: wrap("reject") };
});
vi.mock("@/lib/api/whatsapp", async (orig) => {
  const real = await orig<typeof import("@/lib/api/whatsapp")>();
  const wrap = (n: string) => (...a: unknown[]) => h.api(n, ...a);
  return { ...real, getThread: wrap("thread"), markConversationRead: wrap("read") };
});

import { approveChatMessageAction, markReadAction, refreshThreadAction, rejectChatMessageAction, replyAction } from "./actions";

const message = (status: string, reason: string) => ({ message: { status, reason }, replayed: false, dispatched: null });
beforeEach(() => h.api.mockReset().mockResolvedValue(message("sent", "auto_allowed")));

describe("the chat actions", () => {
  it("a reply is a new outbox message with the words, the language and the category 'reply to inbound'; the answer is the state and the reason only", async () => {
    expect(await replyAction(T, L, M, "  Yes, we have.  ", "te")).toEqual({ ok: true, data: { status: "sent", reason: "auto_allowed" } });
    expect(h.api).toHaveBeenCalledWith("submit", "tok", T, { messageId: M, leadId: L, text: "Yes, we have.", language: "te", category: "reply_to_inbound" });
  });
  it("approving sends it, declining blocks it; each answers the state and the reason", async () => {
    h.api.mockResolvedValueOnce(message("queued", "owner_approved"));
    expect(await approveChatMessageAction(T, M)).toEqual({ ok: true, data: { status: "queued", reason: "owner_approved" } });
    expect(h.api).toHaveBeenLastCalledWith("approve", "tok", T, M);
    h.api.mockResolvedValueOnce(message("blocked", "owner_rejected"));
    expect(await rejectChatMessageAction(T, M)).toEqual({ ok: true, data: { status: "blocked", reason: "owner_rejected" } });
  });
  it("reads the thread again and marks it read", async () => {
    h.api.mockResolvedValueOnce({ lead_id: L });
    expect(await refreshThreadAction(T, L)).toMatchObject({ ok: true });
    expect(h.api).toHaveBeenLastCalledWith("thread", "tok", T, L);
    expect(await markReadAction(T, L)).toEqual({ ok: true, data: null });
    expect(h.api).toHaveBeenLastCalledWith("read", "tok", T, L);
  });
  it.each([["", "en"], ["   ", "en"], ["x".repeat(1001), "en"], ["Hello", "fr"]])("refuses the reply %j in %j before asking", async (text, language) => {
    expect(await replyAction(T, L, M, text, language)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("refuses ids that are not uuids", async () => {
    for (const r of [await replyAction(T, "x", M, "Hello", "en"), await approveChatMessageAction(T, "x"), await refreshThreadAction("x", L)]) expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("say a refusal in words and keep the closed code", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await approveChatMessageAction(T, M)).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.api.mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 9));
    expect(await replyAction(T, L, M, "Hello", "en")).toMatchObject({ ok: false, kind: "rate_limited", retryAfter: 9 });
    h.api.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await refreshThreadAction(T, L)).toMatchObject({ ok: false, kind: "not_found" });
  });
});
