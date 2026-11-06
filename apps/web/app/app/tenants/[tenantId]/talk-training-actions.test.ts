import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), put: vi.fn(), reset: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/talk-training", () => ({ putTalkTraining: (...a: unknown[]) => h.put(...a), resetTalkTraining: (...a: unknown[]) => h.reset(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { resetTalkTrainingAction, saveTalkTrainingAction } from "./talk-training-actions";

const T = "66666666-6666-4666-8666-666666666666";
const EDIT = { greeting: {}, address: "plain", questions: ["Which colour?"], neverSay: ["guaranteed"], objections: [], examples: [] };
const STATE = { training: { ...EDIT }, defaults: { ...EDIT }, saved: true, rules: [], updatedAt: null };
beforeEach(() => {
  vi.stubEnv("TALK_TRAINING_SCREENS", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.put.mockReset().mockResolvedValue(STATE);
  h.reset.mockReset().mockResolvedValue(STATE);
  h.revalidate.mockReset();
});

describe("How I talk to customers: the Owner's moves", () => {
  it("only the Owner, in a real workspace, with the part switched on; nothing is sent otherwise", async () => {
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await saveTalkTrainingAction(T, EDIT)).toEqual({ ok: false, error: "forbidden" });
    expect(await resetTalkTrainingAction("nope")).toEqual({ ok: false, error: "forbidden" });
    vi.stubEnv("TALK_TRAINING_SCREENS", "");
    expect(await resetTalkTrainingAction(T)).toEqual({ ok: false, error: "not_available" });
    expect(h.put).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
  });
  it("checks the document before sending it, then saves it with the person's own token and redraws Settings", async () => {
    expect(await saveTalkTrainingAction(T, { ...EDIT, neverSay: ["Free", "free!"] })).toEqual({ ok: false, error: "duplicate" });
    expect(h.put).not.toHaveBeenCalled();
    expect(await saveTalkTrainingAction(T, EDIT)).toEqual({ ok: true, data: STATE });
    expect(h.put).toHaveBeenCalledWith("tok", T, EDIT);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
  });
  it("answers the API's refusals as closed words: the second factor, the contract's reasons, anything else", async () => {
    h.put.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await saveTalkTrainingAction(T, EDIT)).toEqual({ ok: false, error: "mfa" });
    h.put.mockRejectedValueOnce(new ApiRequestError(422, "talk_training_invalid", "x", "price_or_promise"));
    expect(await saveTalkTrainingAction(T, EDIT)).toEqual({ ok: false, error: "price_or_promise" });
    h.put.mockRejectedValueOnce(new ApiRequestError(422, "talk_training_invalid", "x", "something_new"));
    expect(await saveTalkTrainingAction(T, EDIT)).toEqual({ ok: false, error: "invalid" });
    h.reset.mockRejectedValueOnce(new ApiRequestError(503, "down", "x"));
    expect(await resetTalkTrainingAction(T)).toEqual({ ok: false, error: "down" });
  });
  it("a lapsed sign-in sends the person to sign in", async () => {
    h.put.mockRejectedValue(new ApiAuthError("out"));
    await expect(saveTalkTrainingAction(T, EDIT)).rejects.toThrow("redirect:/login");
  });
});
