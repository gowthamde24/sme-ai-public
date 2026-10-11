import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseOutboxMessage } from "@/lib/api/outbox";
import { CALL_ID, CALL_JSON, MSG_PRICE, PRICE_JSON } from "@/lib/api/outbox-fixtures";

const approveOutboxMessage = vi.fn();
const rejectOutboxMessage = vi.fn();
const editOutboxMessage = vi.fn();
const approveCallRequest = vi.fn();
const rejectCallRequest = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/outbox")>()),
  approveOutboxMessage: (...a: unknown[]) => approveOutboxMessage(...a),
  rejectOutboxMessage: (...a: unknown[]) => rejectOutboxMessage(...a),
  editOutboxMessage: (...a: unknown[]) => editOutboxMessage(...a),
  approveCallRequest: (...a: unknown[]) => approveCallRequest(...a),
  rejectCallRequest: (...a: unknown[]) => rejectCallRequest(...a),
}));

import { approveCallAction, approveMessageAction, editMessageAction, offerVisitAction, rejectMessageAction } from "./today-actions";
import { OFFER_VISIT_NOTE, decidedToast } from "./today-decisions";
import { appT } from "@/i18n/app";

const T = "22222222-2222-4222-8222-222222222222";
const message = (over: Record<string, unknown>) => parseOutboxMessage({ ...PRICE_JSON, ...over });
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");

beforeEach(() => vi.clearAllMocks());

describe("what a decision says it did (only what really happened)", () => {
  const t = appT("en");
  const NOW = Date.parse("2026-10-11T02:00:00Z");
  it("'Sent' only for a message that went", () => {
    expect(decidedToast(message({ status: "sent", reason: "owner_approved" }), t, NOW)).toBe("Sent to DEMO Lakshmi Textiles.");
    expect(decidedToast(message({ status: "sent", customer: null }), t, NOW)).toBe("Sent to a customer.");
  });
  it("a queued message says when it goes out: the hour in India for the quiet hours, 'on its way' otherwise", () => {
    expect(decidedToast(message({ status: "queued", reason: "quiet_hours", scheduled_for: "2026-10-11T03:30:00Z" }), t, NOW)).toBe("Approved. It goes out at 9:00.");
    expect(decidedToast(message({ status: "queued", reason: "owner_approved", scheduled_for: "2026-10-11T01:00:00Z" }), t, NOW)).toBe("Approved. It is on its way.");
    expect(decidedToast(message({ status: "queued", reason: "owner_approved", scheduled_for: null }), t, NOW)).toBe("Approved. It is on its way.");
  });
  it("a message the outbox refused at the last moment says so in our words, never 'Sent'", () => {
    expect(decidedToast(message({ status: "blocked", reason: "stopped" }), t, NOW)).toBe("Not sent: this customer asked us to stop.");
    expect(decidedToast(message({ status: "blocked", reason: "switch_off" }), t, NOW)).toBe("Not sent: sending is switched off.");
    expect(decidedToast(message({ status: "blocked", reason: "daily_limit" }), t, NOW)).toBe("Not sent: this customer already has the daily limit of messages.");
    expect(decidedToast(message({ status: "blocked", reason: "no_opt_in" }), t, NOW)).toMatch(/^Not sent: the customer has not agreed/);
    expect(decidedToast(message({ status: "blocked", reason: "model_flagged" }), t, NOW)).toBe("Not sent: a rule of the system stopped it.");
    expect(decidedToast(message({ status: "failed", reason: "send_failed", failure_code: "timeout" }), t, NOW)).toBe("Not sent: WhatsApp did not take it.");
  });
});

describe("approve and send", () => {
  it("asks the API with the person's token and answers with what happened", async () => {
    approveOutboxMessage.mockResolvedValue({ message: message({ status: "sent", reason: "owner_approved" }), dispatched: { sent: 1, failed: 0 } });
    expect(await approveMessageAction(T, MSG_PRICE)).toEqual({ ok: true, message: "Sent to DEMO Lakshmi Textiles." });
    expect(approveOutboxMessage).toHaveBeenCalledWith("tok", T, MSG_PRICE);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("refuses a malformed id before any request", async () => {
    expect(await approveMessageAction(T, "../x")).toMatchObject({ ok: false, stale: true });
    expect(await approveMessageAction("nope", MSG_PRICE)).toMatchObject({ ok: false });
    expect(approveOutboxMessage).not.toHaveBeenCalled();
  });
  it.each([
    [refusal(403, "mfa_required"), { mfa: true, error: expect.stringContaining("authenticator app") }],
    [refusal(409, "outbox_state"), { stale: true, error: expect.stringContaining("changed while you were looking") }],
    [refusal(409, "customer_stopped"), { stale: true, error: "This customer asked us to stop. Nothing more is sent or called." }],
    [refusal(404, "not_found"), { stale: true }],
    [refusal(403, "forbidden"), { error: "Your role does not allow this. Nothing was changed." }],
    [refusal(503, "outbox_unavailable"), { error: "That did not work. Nothing was changed. Try again." }],
    [new Error("boom"), { error: "That did not work. Nothing was changed. Try again." }],
  ])("a refusal (%#) becomes one sentence of our own, never the API's", async (error, expected) => {
    approveOutboxMessage.mockRejectedValue(error);
    const r = await approveMessageAction(T, MSG_PRICE);
    expect(r).toMatchObject({ ok: false, ...expected });
    expect(JSON.stringify(r)).not.toContain("the API's own English sentence");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    approveOutboxMessage.mockRejectedValue(new ApiAuthError("x"));
    await expect(approveMessageAction(T, MSG_PRICE)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("Not now, edit", () => {
  it("Not now rejects the message and says nothing was sent", async () => {
    rejectOutboxMessage.mockResolvedValue({ message: message({ status: "blocked", reason: "owner_rejected" }), dispatched: null });
    expect(await rejectMessageAction(T, MSG_PRICE)).toEqual({ ok: true, message: "Not sent. Nothing was sent to DEMO Lakshmi Textiles." });
    expect(rejectOutboxMessage).toHaveBeenCalledWith("tok", T, MSG_PRICE);
  });
  it("edit trims the words, needs two characters, and returns the words the API kept", async () => {
    editOutboxMessage.mockResolvedValue(message({ text: "new words\n\nAI line" }));
    expect(await editMessageAction(T, MSG_PRICE, "  new words  ")).toEqual({ ok: true, message: "Saved. Read it once more, then approve.", text: "new words\n\nAI line" });
    expect(editOutboxMessage).toHaveBeenCalledWith("tok", T, MSG_PRICE, "new words");
    expect(await editMessageAction(T, MSG_PRICE, " a ")).toEqual({ ok: false, error: "Write at least two characters." });
    expect(await editMessageAction(T, MSG_PRICE, "x".repeat(3001))).toMatchObject({ ok: false });
    expect(editOutboxMessage).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled(); // editing changes nothing that is counted
  });
  it("an edit that is too late is a stale card", async () => {
    editOutboxMessage.mockRejectedValue(refusal(409, "outbox_state"));
    expect(await editMessageAction(T, MSG_PRICE, "words")).toMatchObject({ ok: false, stale: true });
  });
});

describe("calls", () => {
  it("Approve call records the approval and says nothing is dialled", async () => {
    approveCallRequest.mockResolvedValue({ ...CALL_JSON, status: "approved" });
    const r = await approveCallAction(T, CALL_ID);
    expect(r).toEqual({ ok: true, message: "Call approved for DEMO Lakshmi Textiles. Nothing is dialled by this app." });
    expect(approveCallRequest).toHaveBeenCalledWith("tok", T, CALL_ID);
  });
  it("Offer a store visit declines the call with a fixed note and does not claim the offer was sent", async () => {
    rejectCallRequest.mockResolvedValue({ ...CALL_JSON, status: "rejected", decision_note: OFFER_VISIT_NOTE });
    const r = await offerVisitAction(T, CALL_ID);
    expect(rejectCallRequest).toHaveBeenCalledWith("tok", T, CALL_ID, "offer_store_visit");
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("This app has not sent the offer.") });
    expect(approveCallRequest).not.toHaveBeenCalled();
  });
  it("only the owner with a second factor may: an Admin's or a missing factor's refusal is our sentence", async () => {
    approveCallRequest.mockRejectedValue(refusal(403, "forbidden"));
    expect(await approveCallAction(T, CALL_ID)).toEqual({ ok: false, error: "Your role does not allow this. Nothing was changed." });
    rejectCallRequest.mockRejectedValue(refusal(403, "mfa_required"));
    expect(await offerVisitAction(T, CALL_ID)).toMatchObject({ ok: false, mfa: true });
  });
});
