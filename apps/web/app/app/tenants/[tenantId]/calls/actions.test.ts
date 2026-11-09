import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), correct: vi.fn(), hangUp: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/calls", () => ({ correctCall: (...a: unknown[]) => h.correct(...a), hangUpCall: (...a: unknown[]) => h.hangUp(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { correctCallAction, hangUpCallAction } from "./actions";

/** app v4 part 4: Correct it (Owner, Admin, Sales) and End call (Owner, Admin), checked here and again by the API. */
const T = "66666666-6666-4666-8666-666666666666";
const C = "33333333-3333-4333-8333-333333333333";
const SAVED = { summary: "Wants two sarees.", captured: {}, note: null, correctedAt: "2026-11-06T06:00:00Z" };
beforeEach(() => {
  vi.stubEnv("APP_V4", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "sales" });
  h.correct.mockReset().mockResolvedValue(SAVED);
  h.hangUp.mockReset().mockResolvedValue(undefined);
  h.revalidate.mockReset();
});

describe("Correct it", () => {
  it("Sales may correct; the body is checked first and only what was sent goes on", async () => {
    expect(await correctCallAction(T, C, { summary: " Wants two sarees. ", captured: { visit_day: "Sunday", budget: " " } })).toEqual({ ok: true, data: SAVED });
    expect(h.correct).toHaveBeenCalledWith("tok", T, C, { summary: "Wants two sarees.", captured: { visit_day: "Sunday" } });
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/calls/${C}`);
  });
  it("refuses before asking: nothing to correct, a contact in the note, a bad key, too long, another id, a Viewer, the flag off", async () => {
    expect(await correctCallAction(T, C, {})).toEqual({ ok: false, error: "empty" });
    expect(await correctCallAction(T, C, { note: "Ring 98480 22338" })).toEqual({ ok: false, error: "contact" });
    expect(await correctCallAction(T, C, { note: "write to a@b.in" })).toEqual({ ok: false, error: "contact" });
    expect(await correctCallAction(T, C, { captured: { "Bad Key": "x" } })).toEqual({ ok: false, error: "invalid" });
    expect(await correctCallAction(T, C, { summary: "x".repeat(601) })).toEqual({ ok: false, error: "invalid" });
    expect(await correctCallAction(T, "../x", { summary: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(h.correct).not.toHaveBeenCalled();
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await correctCallAction(T, C, { summary: "x" })).toEqual({ ok: false, error: "forbidden" });
    vi.stubEnv("APP_V4", "");
    expect(await correctCallAction(T, C, { summary: "x" })).toEqual({ ok: false, error: "not_available" });
    expect(h.correct).not.toHaveBeenCalled();
  });
  it("says the API's refusals in closed words; a lapsed sign-in goes to sign in", async () => {
    h.correct.mockRejectedValueOnce(new ApiRequestError(422, "correction_invalid", "x"));
    expect(await correctCallAction(T, C, { note: "Kanchi pattu" })).toEqual({ ok: false, error: "contact" });
    h.correct.mockRejectedValueOnce(new ApiRequestError(503, "down", "x"));
    expect(await correctCallAction(T, C, { note: "Kanchi pattu" })).toEqual({ ok: false, error: "down" });
    h.correct.mockRejectedValueOnce(new ApiAuthError("out"));
    await expect(correctCallAction(T, C, { note: "Kanchi pattu" })).rejects.toThrow("redirect:/login");
  });
});

describe("End call", () => {
  it("the Owner and an Admin only; a call on another server says so", async () => {
    expect(await hangUpCallAction(T, C)).toEqual({ ok: false, error: "forbidden" });
    expect(h.hangUp).not.toHaveBeenCalled();
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await hangUpCallAction(T, C)).toEqual({ ok: true });
    expect(h.hangUp).toHaveBeenCalledWith("tok", T, C);
    h.hangUp.mockRejectedValueOnce(new ApiRequestError(409, "call_not_here", "x"));
    expect(await hangUpCallAction(T, C)).toEqual({ ok: false, error: "not_here" });
  });
});
