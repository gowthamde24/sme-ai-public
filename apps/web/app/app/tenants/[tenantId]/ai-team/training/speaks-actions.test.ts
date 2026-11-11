import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const h = vi.hoisted(() => ({ tenant: vi.fn(), save: vi.fn(), facts: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/talk-training/speaks-source", () => ({ saveSpeaks: (...a: unknown[]) => h.save(...a) }));
vi.mock("./speaks-facts", () => ({ readFacts: (...a: unknown[]) => h.facts(...a) }));

import { saveSpeaksAction } from "./speaks-actions";

const T = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  vi.stubEnv("TALK_TRAINING_SCREENS", "1");
  vi.stubEnv("SPEAKS_PANEL_SCREENS", "mock");
  h.tenant.mockResolvedValue({ role: "owner" });
  h.facts.mockResolvedValue({ legacyAddress: null, packDefault: "friendly", ownerName: "Gowtham" });
  h.save.mockResolvedValue({ tone: { value: "respectful" } });
});

describe("How your assistant speaks: the Owner's save", () => {
  it("only the Owner, with the flags on; the change is checked with the contract's rules before anything is asked; Introduce as is cleaned", async () => {
    expect(await saveSpeaksAction(T, { tone: "respectful" })).toEqual({ ok: true, data: { tone: { value: "respectful" } } });
    expect(h.save).toHaveBeenCalledWith({ token: "tok", tenantId: T }, { tone: "respectful" }, expect.objectContaining({ ownerName: "Gowtham" }));
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/ai-team/training`);
    await saveSpeaksAction(T, { introduceAs: { kind: "custom", text: "  Gowtham's   AI assistant " } });
    expect(h.save).toHaveBeenLastCalledWith({ token: "tok", tenantId: T }, { introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } }, expect.anything());
    h.save.mockClear();
    expect(await saveSpeaksAction(T, { tone: "casual" })).toEqual({ ok: false, error: "tone" });
    expect(await saveSpeaksAction(T, { words: { kn: { region: "coastal" } } })).toEqual({ ok: false, error: "region" });
    expect(await saveSpeaksAction(T, { introduceAs: { kind: "custom", text: "a human AI assistant" } })).toEqual({ ok: false, error: "introduce" });
    expect(await saveSpeaksAction(T, {})).toEqual({ ok: false, error: "empty" });
    expect(await saveSpeaksAction("../x", { tone: "friendly" })).toEqual({ ok: false, error: "forbidden" });
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await saveSpeaksAction(T, { tone: "friendly" })).toEqual({ ok: false, error: "forbidden" });
    vi.stubEnv("SPEAKS_PANEL_SCREENS", "");
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await saveSpeaksAction(T, { tone: "friendly" })).toEqual({ ok: false, error: "not_available" });
    expect(h.save).not.toHaveBeenCalled();
  });
  it("the second factor, a refusal that carried Introduce as, any other 422, a failure and an expired session", async () => {
    h.save.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await saveSpeaksAction(T, { tone: "friendly" })).toEqual({ ok: false, error: "mfa" });
    h.save.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "no_ai_assistant"));
    expect(await saveSpeaksAction(T, { introduceAs: { kind: "owner", text: "Gowtham" } })).toEqual({ ok: false, error: "introduce" });
    h.save.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveSpeaksAction(T, { tone: "friendly" })).toEqual({ ok: false, error: "rejected" });
    h.save.mockRejectedValueOnce(new Error("boom"));
    expect(await saveSpeaksAction(T, { tone: "friendly" })).toEqual({ ok: false, error: "down" });
    h.save.mockRejectedValueOnce(new ApiAuthError("expired"));
    await expect(saveSpeaksAction(T, { tone: "friendly" })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
