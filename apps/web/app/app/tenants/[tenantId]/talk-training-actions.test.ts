import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), put: vi.fn(), reset: vi.fn(), practice: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/talk-training", () => ({ PRACTICE: { turns: 20, text: 400 }, putTalkTraining: (...a: unknown[]) => h.put(...a), resetTalkTraining: (...a: unknown[]) => h.reset(...a), practiceCall: (...a: unknown[]) => h.practice(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { practiceCallAction, resetTalkTrainingAction, saveTalkTrainingAction } from "./talk-training-actions";

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
    expect(h.put).toHaveBeenCalledWith("tok", T, { ...EDIT, sayLike: [] });
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
  it("a practice call (app v4): the Owner or an Admin; the turns and the draft are checked first; the API's refusals in closed words", async () => {
    h.practice.mockResolvedValue({ reply: "Namaste!", ended: false, handover: false });
    const turns = [{ who: "customer", text: " Hello " }];
    expect(await practiceCallAction(T, "te", turns, null)).toEqual({ ok: true, data: { reply: "Namaste!", ended: false, handover: false } });
    expect(h.practice).toHaveBeenLastCalledWith("tok", T, "te", [{ who: "customer", text: "Hello" }], null);
    expect(await practiceCallAction(T, "te", turns, EDIT)).toMatchObject({ ok: true });
    expect(h.practice).toHaveBeenLastCalledWith("tok", T, "te", expect.anything(), { ...EDIT, sayLike: [] });
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await practiceCallAction(T, "te", turns, null)).toMatchObject({ ok: true });
    h.tenant.mockResolvedValue({ role: "sales" });
    expect(await practiceCallAction(T, "te", turns, null)).toEqual({ ok: false, error: "forbidden" });
    h.practice.mockClear();
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await practiceCallAction(T, "xx", turns, null)).toEqual({ ok: false, error: "invalid" });
    expect(await practiceCallAction(T, "te", [{ who: "assistant", text: "Hi" }], null)).toEqual({ ok: false, error: "invalid" }); // the last turn must be the customer's
    expect(await practiceCallAction(T, "te", Array(21).fill({ who: "customer", text: "Hi" }), null)).toEqual({ ok: false, error: "invalid" });
    expect(await practiceCallAction(T, "te", [{ who: "customer", text: "x".repeat(401) }], null)).toEqual({ ok: false, error: "invalid" });
    expect(await practiceCallAction(T, "te", turns, { ...EDIT, address: "boss" })).toEqual({ ok: false, error: "invalid" });
    expect(h.practice).not.toHaveBeenCalled();
    h.practice.mockRejectedValueOnce(new ApiRequestError(503, "practice_unavailable", "x"));
    expect(await practiceCallAction(T, "te", turns, null)).toEqual({ ok: false, error: "unavailable" });
    h.practice.mockRejectedValueOnce(new ApiRequestError(429, "practice_busy", "x"));
    expect(await practiceCallAction(T, "te", turns, null)).toEqual({ ok: false, error: "busy" });
    vi.stubEnv("TALK_TRAINING_SCREENS", "");
    expect(await practiceCallAction(T, "te", turns, null)).toEqual({ ok: false, error: "not_available" });
  });
  it("a lapsed sign-in sends the person to sign in", async () => {
    h.put.mockRejectedValue(new ApiAuthError("out"));
    await expect(saveTalkTrainingAction(T, EDIT)).rejects.toThrow("redirect:/login");
  });
});
