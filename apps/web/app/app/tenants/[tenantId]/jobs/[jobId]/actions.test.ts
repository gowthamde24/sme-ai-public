import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const api = { patchJob: vi.fn(), addJobFaq: vi.fn(), removeJobFaq: vi.fn(), testJob: vi.fn() };
vi.mock("@/lib/api/jobs", () => ({ patchJob: (...a: unknown[]) => api.patchJob(...a), addJobFaq: (...a: unknown[]) => api.addJobFaq(...a), removeJobFaq: (...a: unknown[]) => api.removeJobFaq(...a), testJob: (...a: unknown[]) => api.testJob(...a) }));

import { addJobFaqAction, removeJobFaqAction, renameJobAction, setJobFindsOutAction, setJobSettingAction, testJobAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const J = "66666666-6666-4666-8666-666666666601";
const patched = { customName: null, enabled: true, status: "running", says: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
  api.patchJob.mockResolvedValue(patched);
});

describe("the changes of one job's page (Owner and Admin only)", () => {
  it("rename: the name is trimmed and checked first; empty clears it; the API is asked with the clean name", async () => {
    expect(await renameJobAction(T, J, "  Priya ")).toEqual({ ok: true, data: patched });
    expect(api.patchJob).toHaveBeenCalledWith("tok", T, J, { name: "Priya" });
    await renameJobAction(T, J, "   ");
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { name: null });
  });
  it("rename: too long, odd characters or a wrong type never reach the API", async () => {
    for (const bad of ["x".repeat(41), "<script>", "Priya 😀"]) expect(await renameJobAction(T, J, bad)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await renameJobAction(T, J, 5 as unknown as string)).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.patchJob).not.toHaveBeenCalled();
  });
  it("a choice and a tick: closed words only; the API gets exactly that one change", async () => {
    await setJobSettingAction(T, J, "response", "after_5");
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { settings: { response: "after_5" } });
    await setJobFindsOutAction(T, J, "budget", false);
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { findsOut: { budget: false } });
    api.patchJob.mockClear();
    expect(await setJobSettingAction(T, J, "bad key", "x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await setJobSettingAction(T, J, "response", "x".repeat(41))).toMatchObject({ ok: false, kind: "invalid" });
    expect(await setJobFindsOutAction(T, J, "budget", "yes" as unknown as boolean)).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.patchJob).not.toHaveBeenCalled();
  });
  it("a FAQ is cleaned before it is added; a short or empty one is refused; removing needs a plain id", async () => {
    api.addJobFaq.mockResolvedValue({ id: "f1", question: "Open on Sundays?", answer: "Yes." });
    expect(await addJobFaqAction(T, J, " Open on Sundays? ", " Yes. ")).toMatchObject({ ok: true });
    expect(api.addJobFaq).toHaveBeenCalledWith("tok", T, J, "Open on Sundays?", "Yes.");
    expect(await addJobFaqAction(T, J, "ab", "Yes")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await addJobFaqAction(T, J, "Open?", "   ")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.addJobFaq).toHaveBeenCalledTimes(1);
    expect(await removeJobFaqAction(T, J, "f1")).toEqual({ ok: true, data: { id: "f1" } });
    expect(await removeJobFaqAction(T, J, "../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.removeJobFaq).toHaveBeenCalledTimes(1);
  });
  it("the test goes to the owner's own phone: only 'call' or 'message'", async () => {
    api.testJob.mockResolvedValue({ channel: "call", sent: false });
    expect(await testJobAction(T, J, "call")).toEqual({ ok: true, data: { channel: "call", sent: false } });
    expect(await testJobAction(T, J, "sms" as unknown as "call")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.testJob).toHaveBeenCalledTimes(1);
  });
  it("Sales and Viewer are refused before anything is asked; so are a bad workspace id and a bad job id", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ role });
      expect(await renameJobAction(T, J, "Priya")).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await setJobSettingAction(T, J, "response", "after_5")).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await addJobFaqAction(T, J, "Open?", "Yes")).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await testJobAction(T, J, "call")).toMatchObject({ ok: false, kind: "forbidden" });
    }
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await renameJobAction("nope", J, "Priya")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await renameJobAction(T, "nope", "Priya")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.patchJob).not.toHaveBeenCalled();
    expect(api.testJob).not.toHaveBeenCalled();
  });
  it("when the API says no, the person gets a sentence in our words, not the API's", async () => {
    api.patchJob.mockRejectedValue(new Error("boom"));
    const r = await renameJobAction(T, J, "Priya");
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error.length).toBeGreaterThan(0);
  });
});
