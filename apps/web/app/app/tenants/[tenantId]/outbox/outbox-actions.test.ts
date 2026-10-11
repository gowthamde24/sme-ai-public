import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const approveMessageAction = vi.fn();
const rejectMessageAction = vi.fn();
const editMessageAction = vi.fn();
const dispatchOutbox = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), dispatchOutbox: (...a: unknown[]) => dispatchOutbox(...a) }));
vi.mock("../today-actions", () => ({
  approveMessageAction: (...a: unknown[]) => approveMessageAction(...a),
  rejectMessageAction: (...a: unknown[]) => rejectMessageAction(...a),
  editMessageAction: (...a: unknown[]) => editMessageAction(...a),
}));

import { approveFromOutboxAction, dispatchNowAction, editFromOutboxAction, rejectFromOutboxAction } from "./outbox-actions";

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
    approveMessageAction.mockResolvedValue({ ok: false, error: "This needs your authenticator app.", mfa: true });
    expect(await approveFromOutboxAction(T, ID)).toEqual({ ok: false, error: "This needs your authenticator app.", mfa: true });
  });
  it("edit is Today's edit and changes nothing that is counted", async () => {
    editMessageAction.mockResolvedValue({ ok: true, message: "Saved.", text: "new" });
    await editFromOutboxAction(T, ID, "new");
    expect(editMessageAction).toHaveBeenCalledWith(T, ID, "new");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("Send what is due now", () => {
  it("hands what is due to the channel and says how many went", async () => {
    dispatchOutbox.mockResolvedValue({ sent: 2, failed: 0 });
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "2 sent." });
    expect(dispatchOutbox).toHaveBeenCalledWith("tok", T);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("says so when nothing was due, and when some failed", async () => {
    dispatchOutbox.mockResolvedValue({ sent: 0, failed: 0 });
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "Nothing was due." });
    dispatchOutbox.mockResolvedValue({ sent: 1, failed: 2 });
    expect(await dispatchNowAction(T)).toEqual({ ok: true, message: "1 sent, 2 failed." });
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
