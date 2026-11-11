import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const h = vi.hoisted(() => ({ tenant: vi.fn(), preview: vi.fn(), add: vi.fn(), edit: vi.fn(), run: vi.fn(), drop: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/lead-finder/sweeps-source", () => ({ previewNew: (...a: unknown[]) => h.preview(...a), addSweep: (...a: unknown[]) => h.add(...a), editSweep: (...a: unknown[]) => h.edit(...a), runNow: (...a: unknown[]) => h.run(...a), dropSweep: (...a: unknown[]) => h.drop(...a) }));

import { addSweepAction, changeSweepAction, previewSweepAction, removeSweepAction, runSweepAction } from "./sweep-actions";

const T = "11111111-1111-4111-8111-111111111111";
const S = "5e1e0000-0000-4000-8000-000000000001";
const IN = { text: "find new retailers in Jayanagar", weekday: 1, hour: 7, maxResults: 20 };
const as = (role: string) => h.tenant.mockResolvedValue({ id: T, name: "Acme Silks", slug: "acme-silks", role });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  vi.stubEnv("SWEEP_SCREENS", "mock");
  as("owner");
  h.preview.mockResolvedValue({ query: "q" });
  h.add.mockResolvedValue({ id: S });
  h.edit.mockResolvedValue({ id: S });
  h.run.mockResolvedValue({ id: "r" });
  h.drop.mockResolvedValue(undefined);
});

describe("weekly search: only the Owner and an Admin change it, with the person's own token", () => {
  it("add: the words go with the person's language; nothing else is added; the page is read again", async () => {
    expect(await addSweepAction(T, IN)).toEqual({ ok: true, data: { id: S } });
    expect(h.add).toHaveBeenCalledWith({ token: "tok", tenantId: T }, { text: "find new retailers in Jayanagar", language: "en", weekday: 1, hour: 7, maxResults: 20 });
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/retailers`);
  });
  it("the card before the OK: same checks as add, asks the preview and never the create; nothing is read again afterwards", async () => {
    expect(await previewSweepAction(T, IN)).toEqual({ ok: true, data: { query: "q" } });
    expect(h.preview).toHaveBeenCalledWith({ token: "tok", tenantId: T }, { text: "find new retailers in Jayanagar", language: "en", weekday: 1, hour: 7, maxResults: 20 });
    expect(h.add).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
    as("sales");
    expect(await previewSweepAction(T, IN)).toMatchObject({ ok: false, kind: "forbidden" });
    as("owner");
    expect(await previewSweepAction(T, { ...IN, hour: 30 })).toMatchObject({ ok: false, kind: "invalid" });
    h.preview.mockRejectedValueOnce(new ApiRequestError(409, "sweep_limit_reached", "x"));
    expect(await previewSweepAction(T, IN)).toMatchObject({ ok: false, code: "sweep_limit_reached", error: "You have the most weekly searches allowed. Remove one to add another." });
  });
  it("Sales and a Viewer are refused before anything is asked; so is a bad id, a bad input, and the flag off", async () => {
    for (const role of ["sales", "viewer"]) {
      as(role);
      expect(await addSweepAction(T, IN)).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await changeSweepAction(T, S, { enabled: false })).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await runSweepAction(T, S)).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await removeSweepAction(T, S)).toMatchObject({ ok: false, kind: "forbidden" });
    }
    as("admin");
    expect(await addSweepAction(T, { ...IN, text: " a " })).toMatchObject({ ok: false, kind: "invalid", error: "Type what to find and where." });
    expect(await addSweepAction(T, { ...IN, text: "x".repeat(301) })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await addSweepAction(T, { ...IN, weekday: 9 })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await addSweepAction(T, { ...IN, hour: -1 })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await addSweepAction(T, { ...IN, maxResults: 50 })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await addSweepAction(T, null)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await changeSweepAction(T, "../x", { enabled: false })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await changeSweepAction(T, S, {})).toMatchObject({ ok: false, kind: "invalid" });
    expect(await changeSweepAction(T, S, { hour: 99 })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await changeSweepAction(T, S, { enabled: "yes" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await runSweepAction(T, "nope")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await removeSweepAction(T, "nope")).toMatchObject({ ok: false, kind: "invalid" });
    vi.stubEnv("SWEEP_SCREENS", "");
    expect(await addSweepAction(T, IN)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await runSweepAction(T, S)).toMatchObject({ ok: false, kind: "invalid" });
    expect([h.add, h.edit, h.run, h.drop].every((f) => f.mock.calls.length === 0)).toBe(true);
  });
  it("pause, change, run now and remove ask once each and say ok; the Owner and an Admin may", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      expect(await changeSweepAction(T, S, { enabled: false })).toMatchObject({ ok: true });
      expect(await changeSweepAction(T, S, { weekday: 3, hour: 0, maxResults: 5 })).toMatchObject({ ok: true });
      expect(await runSweepAction(T, S)).toMatchObject({ ok: true });
      expect(await removeSweepAction(T, S)).toEqual({ ok: true, data: { removed: true } });
    }
    expect(h.edit).toHaveBeenCalledWith({ token: "tok", tenantId: T }, S, { enabled: false });
    expect(h.edit).toHaveBeenCalledWith({ token: "tok", tenantId: T }, S, { weekday: 3, hour: 0, maxResults: 5 });
  });
  it("says the API's refusals in plain words: the most weekly searches, the day's cap, the plan, a sweep that is gone", async () => {
    h.add.mockRejectedValueOnce(new ApiRequestError(409, "sweep_limit_reached", "x"));
    expect(await addSweepAction(T, IN)).toMatchObject({ ok: false, code: "sweep_limit_reached", error: "You have the most weekly searches allowed. Remove one to add another." });
    h.run.mockRejectedValueOnce(new ApiRequestError(429, "search_cap_reached", "x"));
    expect(await runSweepAction(T, S)).toMatchObject({ ok: false, kind: "rate_limited", error: "Today's searches are used up. Try again tomorrow, or change the limit in Settings." });
    h.add.mockRejectedValueOnce(new ApiRequestError(403, "not_in_plan", "x"));
    expect(await addSweepAction(T, IN)).toMatchObject({ ok: false });
    h.drop.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await removeSweepAction(T, S)).toMatchObject({ ok: false, kind: "not_found" });
    h.edit.mockRejectedValueOnce(new ApiAuthError("expired"));
    await expect(changeSweepAction(T, S, { enabled: true })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
