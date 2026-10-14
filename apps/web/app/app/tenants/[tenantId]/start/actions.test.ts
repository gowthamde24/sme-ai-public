import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const saveProfile = vi.fn();
const loadExample = vi.fn();
const removeExample = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/profile", () => ({ saveProfile: (...a: unknown[]) => saveProfile(...a) }));
vi.mock("@/lib/api/example-data", () => ({ loadExampleData: (...a: unknown[]) => loadExample(...a), removeExampleData: (...a: unknown[]) => removeExample(...a) }));

import { loadExampleAction, removeExampleAction, saveProfileAction } from "./actions";

const T = "22222222-2222-2222-2222-222222222222";
const NONE = { companies: 0, contacts: 0, leads: 0, products: 0 };
const COUNTS = { companies: 2, contacts: 3, leads: 3, products: 4 };
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const target = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    return (e as { to?: string }).to ?? String(e);
  }
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, name: "x", slug: "x", role: "owner" });
  saveProfile.mockResolvedValue({ name: "A", town: "B", setupComplete: true });
  loadExample.mockResolvedValue("ok");
  removeExample.mockResolvedValue({ result: "ok", removed: { removed: COUNTS, kept: NONE } });
});

describe("saving the business name and city (the first checklist question)", () => {
  it("authenticates, then saves both answers with the person's token and refreshes the frame", async () => {
    expect(await saveProfileAction(T, undefined, form({ name: " Pavers Corner ", town: " Guntur " }))).toEqual({ ok: true });
    expect(requireUser).toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith("tok", T, { name: "Pavers Corner", town: "Guntur" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it("lets an Admin do it and refuses everyone else before the API is asked to change anything", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "admin" });
    expect(await saveProfileAction(T, undefined, form({ name: "A", town: "Bb" }))).toEqual({ ok: true });
    for (const role of ["sales", "viewer"]) {
      saveProfile.mockClear();
      fetchTenant.mockResolvedValue({ id: T, role });
      expect(await saveProfileAction(T, undefined, form({ name: "A", town: "Bb" })), role).toEqual({ ok: false, error: "role" });
      expect(saveProfile).not.toHaveBeenCalled();
    }
  });
  it("refuses an empty or over-long answer, and a workspace id that is not one, without asking the API", async () => {
    for (const bad of [{ name: "", town: "Guntur" }, { name: "A", town: "G" }, { name: "x".repeat(121), town: "Guntur" }, { name: "A", town: "x".repeat(81) }]) expect(await saveProfileAction(T, undefined, form(bad))).toEqual({ ok: false, error: "invalid" });
    expect(await saveProfileAction("nope", undefined, form({ name: "A", town: "Bb" }))).toEqual({ ok: false, error: "role" });
    expect(saveProfile).not.toHaveBeenCalled();
  });
  it("says 'role' for a 403, 'session' for a rejected session and 'failed' for anything else", async () => {
    saveProfile.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveProfileAction(T, undefined, form({ name: "A", town: "Bb" }))).toEqual({ ok: false, error: "role" });
    saveProfile.mockRejectedValueOnce(new ApiAuthError("x"));
    expect(await saveProfileAction(T, undefined, form({ name: "A", town: "Bb" }))).toEqual({ ok: false, error: "session" });
    saveProfile.mockRejectedValueOnce(new ApiRequestError(500, "x", "x"));
    expect(await saveProfileAction(T, undefined, form({ name: "A", town: "Bb" }))).toEqual({ ok: false, error: "failed" });
  });
});

describe("example data", () => {
  it("loads and goes back to Today with the result in the address", async () => {
    expect(await target(() => loadExampleAction(T))).toBe(`/app/tenants/${T}?example=loaded`);
    expect(loadExample).toHaveBeenCalledWith("tok", T);
    expect(await target(() => removeExampleAction(T))).toBe(`/app/tenants/${T}?example=removed`);
    expect(removeExample).toHaveBeenCalledWith("tok", T);
  });
  it("says how many sample rows stayed because they were used (the API keeps them and counts them)", async () => {
    removeExample.mockResolvedValueOnce({ result: "ok", removed: { removed: COUNTS, kept: { ...NONE, products: 2, leads: 1 } } });
    expect(await target(() => removeExampleAction(T))).toBe(`/app/tenants/${T}?example=removed&kept=3`);
  });
  it("says 'unavailable' when the server has no such route, and 'failed' for a refusal or a failure", async () => {
    loadExample.mockResolvedValueOnce("unavailable");
    expect(await target(() => loadExampleAction(T))).toBe(`/app/tenants/${T}?example=unavailable`);
    loadExample.mockResolvedValueOnce("refused");
    expect(await target(() => loadExampleAction(T))).toBe(`/app/tenants/${T}?example=failed`);
    loadExample.mockResolvedValueOnce("failed");
    expect(await target(() => loadExampleAction(T))).toBe(`/app/tenants/${T}?example=failed`);
  });
  it("is for the Owner and an Admin only: a Sales person or a Viewer never reaches the API", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ id: T, role });
      expect(await target(() => loadExampleAction(T)), role).toBe(`/app/tenants/${T}?example=failed`);
      expect(await target(() => removeExampleAction(T)), role).toBe(`/app/tenants/${T}?example=failed`);
    }
    expect(loadExample).not.toHaveBeenCalled();
    expect(removeExample).not.toHaveBeenCalled();
  });
  it("sends a rejected session to sign in", async () => {
    loadExample.mockRejectedValueOnce(new ApiAuthError("x"));
    expect(await target(() => loadExampleAction(T))).toBe("/login");
  });
});
