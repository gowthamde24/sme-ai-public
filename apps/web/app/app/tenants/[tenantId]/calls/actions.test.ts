import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), correct: vi.fn(), hangUp: vi.fn(), place: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/calls", () => ({ correctCall: (...a: unknown[]) => h.correct(...a), hangUpCall: (...a: unknown[]) => h.hangUp(...a), placeTestCall: (...a: unknown[]) => h.place(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { correctCallAction, hangUpCallAction, placeTestCallAction } from "./actions";

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
  h.place.mockReset().mockResolvedValue({ callId: C });
  vi.stubEnv("TEST_CALL_SCREENS", "1");
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

describe("Place a test call (job test-call; C1's PR #434)", () => {
  const GOAL = "Ask if they would like to visit the shop on Saturday to see the new silk sarees.";
  const ID = "a1b2c3d4e5f60718";
  const IN = { toId: ID, language: "te", goal: `  ${GOAL}  ` };
  it("only the Owner places it; the body is trimmed and goes with the Owner's own token", async () => {
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: true, callId: C });
    expect(h.place).toHaveBeenCalledWith("tok", T, { toId: ID, language: "te", goal: GOAL });
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/calls`);
    for (const role of ["admin", "sales", "viewer"]) {
      h.place.mockClear();
      h.tenant.mockResolvedValue({ role });
      expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "forbidden" });
      expect(h.place).not.toHaveBeenCalled();
    }
  });
  it("is refused before anything is asked: the flags, a bad number, a goal the API would refuse, a language that is not offered, another id", async () => {
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await placeTestCallAction(T, { ...IN, toId: "+919848022338" })).toEqual({ ok: false, error: "invalid" }); // a typed number is never sent: only an id of the list
    expect(await placeTestCallAction(T, { ...IN, toId: undefined })).toEqual({ ok: false, error: "invalid" });
    expect(await placeTestCallAction(T, { ...IN, goal: "Ring 98480 22338 now please" })).toEqual({ ok: false, error: "goal", problem: "number" });
    expect(await placeTestCallAction(T, { ...IN, goal: "short" })).toEqual({ ok: false, error: "goal", problem: "short" });
    expect(await placeTestCallAction(T, { ...IN, language: "ta" })).toEqual({ ok: false, error: "invalid" });
    expect(await placeTestCallAction(T, { ...IN, language: "mr" })).toEqual({ ok: false, error: "invalid" });
    expect(await placeTestCallAction("../x", IN)).toEqual({ ok: false, error: "invalid" });
    expect(await placeTestCallAction(T, null)).toEqual({ ok: false, error: "invalid" });
    vi.stubEnv("TEST_CALL_SCREENS", "");
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("TEST_CALL_SCREENS", "1");
    vi.stubEnv("APP_V4", "");
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "not_available" });
    expect(h.place).not.toHaveBeenCalled();
  });
  it("says the gate's refusal with its own closed word (nothing was dialled), and the other failures in closed words", async () => {
    h.tenant.mockResolvedValue({ role: "owner" });
    h.place.mockRejectedValueOnce(new ApiRequestError(409, "call_not_allowed", "That call is not allowed.", "outside_window"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "refused", reason: "outside_window" });
    h.place.mockRejectedValueOnce(new ApiRequestError(409, "call_not_allowed", "x", "Not A Word!"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "refused", reason: null });
    h.place.mockRejectedValueOnce(new ApiRequestError(502, "call_provider_failed", "x"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "provider" });
    h.place.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "forbidden" });
    h.place.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "invalid" });
    h.place.mockRejectedValueOnce(new ApiRequestError(503, "calls_unavailable", "x"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "off" });
    h.place.mockRejectedValueOnce(new ApiRequestError(500, "internal", "x"));
    expect(await placeTestCallAction(T, IN)).toEqual({ ok: false, error: "down" });
    h.place.mockRejectedValueOnce(new ApiAuthError());
    await expect(placeTestCallAction(T, IN)).rejects.toThrow("redirect:/login");
  });
});
