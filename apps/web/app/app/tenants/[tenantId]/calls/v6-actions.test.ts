import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), approve: vi.fn(), approveMaterial: vi.fn(), whisper: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/quotes", () => ({ approveQuote: (...a: unknown[]) => h.approve(...a) }));
vi.mock("@/lib/api/calls", () => ({ whisperCall: (...a: unknown[]) => h.whisper(...a) }));
vi.mock("../quotes/material-actions", () => ({ approveMaterialQuoteAction: (...a: unknown[]) => h.approveMaterial(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { approveCallQuoteAction, whisperCallAction } from "./v6-actions";

/** Design system v6: Approve on the quote a call left behind, and Whisper on a live call. */
const T = "66666666-6666-4666-8666-666666666666";
const C = "33333333-3333-4333-8333-333333333333";
const Q = "44444444-4444-4444-8444-444444444444";
beforeEach(() => {
  vi.stubEnv("DESIGN_V6", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.approve.mockReset().mockResolvedValue({});
  h.approveMaterial.mockReset().mockResolvedValue({ ok: true });
  h.whisper.mockReset().mockResolvedValue(undefined);
  h.revalidate.mockReset();
});

describe("Approve on a call's quote", () => {
  it("approves through the existing quote approval and says nothing was sent", async () => {
    const r = await approveCallQuoteAction(T, Q, "quote");
    expect(h.approve).toHaveBeenCalledWith("tok", T, Q);
    expect(r).toEqual({ ok: true, message: "Approved. Nothing was sent. Open it in WhatsApp to send it yourself." });
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/calls`);
  });
  it("a building-materials quote goes through the materials approval", async () => {
    const r = await approveCallQuoteAction(T, Q, "material_quote");
    expect(h.approveMaterial).toHaveBeenCalledWith(T, Q);
    expect(h.approve).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    h.approveMaterial.mockResolvedValueOnce({ ok: false, error: "Set up your authenticator app first.", mfa: true });
    expect(await approveCallQuoteAction(T, Q, "material_quote")).toEqual({ ok: false, error: "Set up your authenticator app first.", mfa: true });
  });
  it("refuses before asking: a bad id, an unknown kind, the flag off", async () => {
    expect((await approveCallQuoteAction(T, "../x", "quote")).ok).toBe(false);
    expect((await approveCallQuoteAction(T, Q, "order")).ok).toBe(false);
    vi.stubEnv("DESIGN_V6", "");
    expect((await approveCallQuoteAction(T, Q, "quote")).ok).toBe(false);
    expect(h.approve).not.toHaveBeenCalled();
  });
  it("says the API's refusals in our words: second factor, role, a quote that moved on", async () => {
    h.approve.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await approveCallQuoteAction(T, Q, "quote")).toMatchObject({ ok: false, mfa: true });
    h.approve.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await approveCallQuoteAction(T, Q, "quote")).toMatchObject({ ok: false, error: expect.stringMatching(/owner or an admin|role/i) });
    h.approve.mockRejectedValueOnce(new ApiRequestError(409, "quote_state", "x"));
    expect(await approveCallQuoteAction(T, Q, "quote")).toMatchObject({ ok: false, stale: true });
    h.approve.mockRejectedValueOnce(new Error("boom"));
    const r = await approveCallQuoteAction(T, Q, "quote");
    expect(r.ok).toBe(false);
    h.approve.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(approveCallQuoteAction(T, Q, "quote")).rejects.toThrow("redirect:/login");
  });
});

describe("Whisper", () => {
  it("Owner and Admin send trimmed words; the API is asked once", async () => {
    expect(await whisperCallAction(T, C, "  Offer the Saturday visit ")).toEqual({ ok: true });
    expect(h.whisper).toHaveBeenCalledWith("tok", T, C, "Offer the Saturday visit");
    h.tenant.mockResolvedValue({ role: "admin" });
    expect((await whisperCallAction(T, C, "Hi")).ok).toBe(true);
  });
  it("Sales and Viewer cannot whisper; nothing is asked", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.whisper).not.toHaveBeenCalled();
  });
  it("empty or too long words, a bad id and the flag off are refused first", async () => {
    expect(await whisperCallAction(T, C, "   ")).toEqual({ ok: false, error: "empty" });
    expect(await whisperCallAction(T, C, "x".repeat(301))).toEqual({ ok: false, error: "empty" });
    expect(await whisperCallAction(T, C, 5)).toEqual({ ok: false, error: "empty" });
    expect(await whisperCallAction(T, "../x", "Hi")).toEqual({ ok: false, error: "forbidden" });
    vi.stubEnv("DESIGN_V6", "");
    expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "not_available" });
    expect(h.whisper).not.toHaveBeenCalled();
  });
  it("says the API's refusals in closed words", async () => {
    h.whisper.mockRejectedValueOnce(new ApiRequestError(409, "call_not_here", "x"));
    expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "not_here" });
    h.whisper.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "forbidden" });
    h.whisper.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "not_available" });
    h.whisper.mockRejectedValueOnce(new Error("boom"));
    expect(await whisperCallAction(T, C, "Hi")).toEqual({ ok: false, error: "down" });
    h.whisper.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(whisperCallAction(T, C, "Hi")).rejects.toThrow("redirect:/login");
  });
});
