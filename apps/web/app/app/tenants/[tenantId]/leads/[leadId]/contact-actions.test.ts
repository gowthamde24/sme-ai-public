import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseOutboxMessage } from "@/lib/api/outbox";
import { CALL_ID, CALL_JSON, MSG_PRICE, PRICE_JSON, SENT_JSON } from "@/lib/api/outbox-fixtures";

const submitOutboxMessage = vi.fn();
const createCallRequest = vi.fn();
const recordTouch = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), submitOutboxMessage: (...a: unknown[]) => submitOutboxMessage(...a), createCallRequest: (...a: unknown[]) => createCallRequest(...a) }));
vi.mock("@/lib/api/followups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/followups")>()), recordTouch: (...a: unknown[]) => recordTouch(...a) }));

import { contactWhatsAppAction, requestCallAction } from "./contact-actions";

const T = "22222222-2222-4222-8222-222222222222";
const L = "7c1f0a52-3b11-4c6e-9d0a-5e2b8f4a1c01";
const TOUCH = "33333333-aaaa-4aaa-8aaa-000000000001";
const input = { messageId: MSG_PRICE, touchId: TOUCH, text: "Hello, we are open today.", language: "en", category: "info", keepRecord: true };
const message = (over: Record<string, unknown>) => parseOutboxMessage({ ...SENT_JSON, ...over });
const refusal = (status: number, code: string, reason?: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person", reason);

beforeEach(() => vi.clearAllMocks());

describe("Contact on WhatsApp", () => {
  it("sends the words for this lead to the outbox as the owner's own: no number, no status", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: false });
    await contactWhatsAppAction(T, L, { ...input, text: "  Hello, we are open today.  " });
    expect(submitOutboxMessage).toHaveBeenCalledWith("tok", T, { messageId: MSG_PRICE, leadId: L, text: "Hello, we are open today.", language: "en", category: "info" });
  });
  it("a message that really went, with the box ticked: a touch is recorded (outgoing, WhatsApp, with the page's id)", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: false });
    recordTouch.mockResolvedValue({ touch_id: TOUCH, lead_id: L, direction: "out", replayed: false });
    const r = await contactWhatsAppAction(T, L, input);
    expect(recordTouch).toHaveBeenCalledWith("tok", T, L, { id: TOUCH, direction: "out", channel: "whatsapp" });
    expect(r).toEqual({ ok: true, channel: "whatsapp", state: "sent", text: "Sent to the customer.", record: "kept", recordText: "A record was added to this lead's history." });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/followups`);
  });
  it("UNTICKED: the message still goes and no touch is recorded", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: false });
    const r = await contactWhatsAppAction(T, L, { ...input, keepRecord: false });
    expect(submitOutboxMessage).toHaveBeenCalledTimes(1);
    expect(recordTouch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, state: "sent", record: "off", recordText: "No record was made, as you chose." });
  });
  it("a message that has NOT gone out (waiting, queued, blocked) is never recorded as a contact, ticked or not", async () => {
    for (const m of [
      message({ status: "needs_approval", reason: "money", sent_at: null }),
      message({ status: "queued", reason: "quiet_hours", scheduled_for: "2099-01-01T03:30:00Z", sent_at: null }),
      message({ status: "queued", reason: "auto_allowed", scheduled_for: null, sent_at: null }),
      message({ status: "blocked", reason: "stopped", sent_at: null }),
      message({ status: "failed", reason: "send_failed", sent_at: null }),
    ]) {
      submitOutboxMessage.mockResolvedValue({ message: m, replayed: false });
      const r = await contactWhatsAppAction(T, L, input);
      expect(r).toMatchObject({ ok: true, record: "later" });
      expect((r as { text: string }).text).not.toBe("Sent to the customer.");
    }
    expect(recordTouch).not.toHaveBeenCalled();
  });
  it("says where each unsent message stands, in our words", async () => {
    const say = async (m: Record<string, unknown>) => {
      submitOutboxMessage.mockResolvedValue({ message: message(m), replayed: false });
      return (await contactWhatsAppAction(T, L, input)) as { state: string; text: string };
    };
    expect(await say({ status: "needs_approval", reason: "money" })).toMatchObject({ state: "needs_approval", text: "Waiting for the owner or an admin to approve it." });
    expect(await say({ status: "queued", reason: "quiet_hours", scheduled_for: "2099-01-01T03:30:00Z" })).toMatchObject({ state: "queued", text: "Queued. It goes out at 9:00." });
    expect(await say({ status: "queued", reason: "auto_allowed", scheduled_for: null })).toMatchObject({ state: "queued", text: "Ready. It goes out when the owner or an admin sends the waiting messages." });
    expect(await say({ status: "blocked", reason: "stopped" })).toMatchObject({ state: "blocked", text: "Not sent: this customer asked us to stop." });
    expect(await say({ status: "blocked", reason: "no_opt_in" })).toMatchObject({ state: "blocked", text: expect.stringContaining("has not agreed to WhatsApp") });
    expect(await say({ status: "failed", reason: "send_failed" })).toMatchObject({ state: "blocked", text: "Not sent: WhatsApp did not take it." });
    expect(await say({ status: "blocked", reason: "money" })).toMatchObject({ state: "blocked", text: expect.stringContaining("Not sent:") }); // a reason with no sentence of its own
  });
  it("a message that went but whose record was refused says exactly that, with our sentence", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: false });
    recordTouch.mockRejectedValue(refusal(409, "contact_blocked", "consent"));
    const r = await contactWhatsAppAction(T, L, input);
    expect(r).toMatchObject({ ok: true, state: "sent", record: "failed" });
    expect((r as { recordText: string }).recordText).toContain("The message went out, but the record could not be saved.");
    expect((r as { recordText: string }).recordText).toContain("no recorded consent");
    expect((r as { recordText: string }).recordText).not.toContain("API's own");
  });
  it("a retry replays: the same ids go to the API both times", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: true });
    recordTouch.mockResolvedValue({ touch_id: TOUCH, lead_id: L, direction: "out", replayed: true });
    await contactWhatsAppAction(T, L, input);
    await contactWhatsAppAction(T, L, input);
    expect(submitOutboxMessage.mock.calls[0][2].messageId).toBe(submitOutboxMessage.mock.calls[1][2].messageId);
    expect(recordTouch.mock.calls[0][3].id).toBe(recordTouch.mock.calls[1][3].id);
  });
  it.each([
    ["words too short", { text: " a " }], ["words too long", { text: "x".repeat(3001) }], ["a language the API does not know", { language: "fr" }], ["a kind it does not know", { category: "ads" }],
    ["a bad message id", { messageId: "x" }], ["a bad touch id", { touchId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await contactWhatsAppAction(T, L, { ...input, ...over })).toMatchObject({ ok: false });
    expect(submitOutboxMessage).not.toHaveBeenCalled();
  });
  it("a bad workspace or lead id never reaches the API", async () => {
    expect(await contactWhatsAppAction("nope", L, input)).toMatchObject({ ok: false });
    expect(await contactWhatsAppAction(T, "nope", input)).toMatchObject({ ok: false });
    expect(submitOutboxMessage).not.toHaveBeenCalled();
  });
  it.each([
    [403, "forbidden", "Your role does not allow this. Nothing was changed."],
    [404, "not_found", "This lead is not available."],
    [422, "validation_error", "Something in the form was not accepted."],
    [503, "outbox_unavailable", "Messages are not available right now. Try again shortly."],
    [500, "boom", "That did not work. Nothing was changed. Try again."],
  ])("a %s %s is OUR sentence, never the API's", async (status, code, sentence) => {
    submitOutboxMessage.mockRejectedValue(refusal(status, code));
    expect(await contactWhatsAppAction(T, L, input)).toEqual({ ok: false, error: sentence });
    expect(recordTouch).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    submitOutboxMessage.mockRejectedValue(new ApiAuthError("x"));
    await expect(contactWhatsAppAction(T, L, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("never puts a number or an address in the answer", async () => {
    submitOutboxMessage.mockResolvedValue({ message: message({ status: "sent" }), replayed: false });
    recordTouch.mockResolvedValue({ touch_id: TOUCH, lead_id: L, direction: "out", replayed: false });
    expect(JSON.stringify(await contactWhatsAppAction(T, L, input))).not.toMatch(/\+?\d[\d ]{9,}|@|wa\.me|tel:/);
    void PRICE_JSON;
  });
});

describe("Request a call", () => {
  const call = { requestId: CALL_ID, reason: "Wants to talk about a large order", script: "Hello, this is the shop.", language: "hi" };
  it("makes a request for the lead with the reason and the words to say, and says the owner decides", async () => {
    createCallRequest.mockResolvedValue({ request: CALL_JSON, replayed: false });
    const r = await requestCallAction(T, L, { ...call, reason: "  Wants to talk about a large order  " });
    expect(createCallRequest).toHaveBeenCalledWith("tok", T, { requestId: CALL_ID, leadId: L, reason: "Wants to talk about a large order", scriptDraft: "Hello, this is the shop.", language: "hi" });
    expect(r).toEqual({ ok: true, channel: "call", state: "requested", text: "Requested. The owner decides on Today. Nobody is called until then.", record: "off", recordText: "A call request is not a record: a call is recorded when it happens." });
    expect(recordTouch).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it.each([["no reason", { reason: " " }], ["a reason that is too long", { reason: "r".repeat(501) }], ["no words", { script: "" }], ["words that are too long", { script: "s".repeat(4001) }], ["a language it does not know", { language: "fr" }], ["a bad id", { requestId: "x" }]])("%s never reaches the API", async (_n, over) => {
    expect(await requestCallAction(T, L, { ...call, ...over })).toMatchObject({ ok: false });
    expect(createCallRequest).not.toHaveBeenCalled();
  });
  it("a Viewer's refusal and a missing lead are our sentences; a rejected session signs in", async () => {
    createCallRequest.mockRejectedValue(refusal(403, "forbidden"));
    expect(await requestCallAction(T, L, call)).toEqual({ ok: false, error: "Your role does not allow this. Nothing was changed." });
    createCallRequest.mockRejectedValue(refusal(404, "not_found"));
    expect(await requestCallAction(T, L, call)).toEqual({ ok: false, error: "This lead is not available." });
    createCallRequest.mockRejectedValue(new ApiAuthError("x"));
    await expect(requestCallAction(T, L, call)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
