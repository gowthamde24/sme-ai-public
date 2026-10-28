import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const approveMessageAction = vi.fn();
const rejectMessageAction = vi.fn();
const editMessageAction = vi.fn();
const dispatchOutbox = vi.fn();
const getOutboxMessage = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), dispatchOutbox: (...a: unknown[]) => dispatchOutbox(...a), getOutboxMessage: (...a: unknown[]) => getOutboxMessage(...a) }));
vi.mock("../today-actions", () => ({
  approveMessageAction: (...a: unknown[]) => approveMessageAction(...a),
  rejectMessageAction: (...a: unknown[]) => rejectMessageAction(...a),
  editMessageAction: (...a: unknown[]) => editMessageAction(...a),
}));

import { appT } from "@/i18n/app";
import { MSG_PRICE } from "@/lib/api/outbox-fixtures";

import { approveFromOutboxAction, dispatchNowAction, editFromOutboxAction, outboxDetailAction, rejectFromOutboxAction } from "./outbox-actions";
import { dispatchWords } from "./outbox-dispatch-words";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-aaaa-4aaa-8aaa-000000000001";
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("decisions made from the Outbox", () => {
  it("approve and reject are the same decisions as on Today, then the Outbox is read again", async () => {
    approveMessageAction.mockResolvedValue({ ok: true, message: "Sent to X." });
    expect(await approveFromOutboxAction(T, ID)).toEqual({ ok: true, message: "Sent to X." });
    expect(approveMessageAction).toHaveBeenCalledWith(T, ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
    rejectMessageAction.mockResolvedValue({ ok: true, message: "Not sent." });
    await rejectFromOutboxAction(T, ID);
    expect(rejectMessageAction).toHaveBeenCalledWith(T, ID);
  });
  it("a refusal passes through as it is (our sentence, the mfa and stale flags)", async () => {
    approveMessageAction.mockResolvedValue({ ok: false, error: "This needs your two-step code, if you turned it on.", mfa: true });
    expect(await approveFromOutboxAction(T, ID)).toEqual({ ok: false, error: "This needs your two-step code, if you turned it on.", mfa: true });
  });
  it("edit is Today's edit and changes nothing that is counted", async () => {
    editMessageAction.mockResolvedValue({ ok: true, message: "Saved.", text: "new" });
    await editFromOutboxAction(T, ID, "new");
    expect(editMessageAction).toHaveBeenCalledWith(T, ID, "new");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

const R = (over: Record<string, unknown> = {}) => ({ sent: 0, failed: 0, retry_later: 0, still_due: 0, held_for_later: 0, platform_switch_on: true, ...over });

describe("Send what is due now", () => {
  it("hands what is due to the channel for THIS business and says how many went", async () => {
    dispatchOutbox.mockResolvedValue(R({ sent: 2 }));
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "2 sent." });
    expect(dispatchOutbox).toHaveBeenCalledWith("tok", T);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });

  it("says in plain words what the new fields mean: failed, tried again later, still due, held for the morning", async () => {
    dispatchOutbox.mockResolvedValue(R({ sent: 1, failed: 2, retry_later: 1, still_due: 3, held_for_later: 4 }));
    expect(await dispatchNowAction(T)).toEqual({
      ok: true,
      message: "1 sent. 2 did not go: WhatsApp did not take them. 1 will be tried again in a minute: a photo link could not be made just now. 3 still due but not sent: a rule stopped them at the last check (see Blocked). 4 held for the morning.",
    });
  });

  it("when the whole system is stopped it says so and claims nothing was sent", async () => {
    dispatchOutbox.mockResolvedValue(R({ platform_switch_on: false, held_for_later: 2 }));
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "Sending is stopped for the whole system, so nothing was sent." });
  });

  it("says so when nothing was due; held messages alone are said to be held", async () => {
    dispatchOutbox.mockResolvedValue(R());
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "Nothing was due." });
    dispatchOutbox.mockResolvedValue(R({ held_for_later: 4 }));
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "4 held for the morning." });
  });

  it("an API that does not say whether the system is on is not read as stopped", () => {
    expect(dispatchWords({ sent: 1, failed: 0, retry_later: 0, still_due: 0, held_for_later: 0, platform_switch_on: null }, appT("en"))).toBe("1 sent.");
  });

  it.each([
    [403, "forbidden", "Your role does not allow this. Nothing was changed."],
    [503, "outbox_unavailable", "Messages are not available right now. Try again shortly."],
    [500, "boom", "That did not work. Nothing was changed. Try again."],
  ])("a %s %s is OUR sentence", async (status, code, sentence) => {
    dispatchOutbox.mockRejectedValue(refusal(status, code));
    expect(await dispatchNowAction(T)).toEqual({ ok: false, error: sentence });
  });
  it("a rejected session goes to sign-in; a malformed workspace never reaches the API", async () => {
    dispatchOutbox.mockRejectedValue(new ApiAuthError("x"));
    await expect(dispatchNowAction(T)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await dispatchNowAction("nope")).toMatchObject({ ok: false, stale: true });
    expect(dispatchOutbox).toHaveBeenCalledTimes(1);
  });
});

describe("a message's real history", () => {
  const events = [{ kind: "made", reason: null, reason_text: null, at: "2026-10-10T10:00:00Z", actor: { kind: "assistant", user_id: null, name: null } }];
  it("reads one message and returns only its events", async () => {
    getOutboxMessage.mockResolvedValue({ id: MSG_PRICE, events });
    expect(await outboxDetailAction(T, MSG_PRICE)).toEqual({ ok: true, events });
    expect(getOutboxMessage).toHaveBeenCalledWith("tok", T, MSG_PRICE);
  });
  it("a message without events, a failed read or a bad id is 'not available' (the row keeps its own history); a rejected session signs in", async () => {
    getOutboxMessage.mockResolvedValue({ id: MSG_PRICE, events: null });
    expect(await outboxDetailAction(T, MSG_PRICE)).toEqual({ ok: false });
    getOutboxMessage.mockRejectedValue(refusal(500, "boom"));
    expect(await outboxDetailAction(T, MSG_PRICE)).toEqual({ ok: false });
    getOutboxMessage.mockClear();
    expect(await outboxDetailAction("nope", MSG_PRICE)).toEqual({ ok: false });
    expect(await outboxDetailAction(T, "nope")).toEqual({ ok: false });
    expect(getOutboxMessage).not.toHaveBeenCalled();
    getOutboxMessage.mockRejectedValue(new ApiAuthError("x"));
    await expect(outboxDetailAction(T, MSG_PRICE)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
