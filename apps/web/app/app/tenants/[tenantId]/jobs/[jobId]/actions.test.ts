import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
import { ApiRequestError } from "@/lib/api/client";
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const api = { patchJob: vi.fn(), addJobFaq: vi.fn(), removeJobFaq: vi.fn(), testJob: vi.fn() };
vi.mock("@/lib/api/jobs", () => ({ patchJob: (...a: unknown[]) => api.patchJob(...a), addJobFaq: (...a: unknown[]) => api.addJobFaq(...a), removeJobFaq: (...a: unknown[]) => api.removeJobFaq(...a), testJob: (...a: unknown[]) => api.testJob(...a) }));

import { addJobFaqAction, removeJobFaqAction, renameJobAction, setJobFindsOutAction, setJobSettingAction, testJobAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const J = "66666666-6666-4666-8666-666666666601";
const patched = { customName: null, enabled: true, status: "running", says: null };

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOBS", "1");
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
    // a toggle is a BOOLEAN on the wire: true/false goes through as it is
    await setJobSettingAction(T, J, "notify_visit", false);
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { settings: { notify_visit: false } });
    await setJobSettingAction(T, J, "notify_visit", true);
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { settings: { notify_visit: true } });
    api.patchJob.mockClear();
    expect(await setJobSettingAction(T, J, "notify_visit", "maybe yes" as unknown as boolean)).toMatchObject({ ok: false, kind: "invalid" });
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
  it("the test goes to the owner's own phone: only 'call' or 'whatsapp' (the contract's test_channel); the free minutes it used come back", async () => {
    api.testJob.mockResolvedValue({ channel: "call", sent: true, minutesUsed: 1 });
    expect(await testJobAction(T, J, "call")).toEqual({ ok: true, data: { channel: "call", sent: true, minutesUsed: 1 } });
    await testJobAction(T, J, "whatsapp");
    expect(api.testJob).toHaveBeenLastCalledWith("tok", T, J, "whatsapp");
    expect(await testJobAction(T, J, "sms" as unknown as "call")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await testJobAction(T, J, "message" as unknown as "call")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.testJob).toHaveBeenCalledTimes(2);
  });
  it("the refusals of the Jobs contract are said in our words and keep their closed code: name_invalid, setting_invalid (with the fields it names), faq_not_allowed, quiet_hours", async () => {
    api.patchJob.mockRejectedValueOnce(new ApiRequestError(422, "name_invalid", "x"));
    expect(await renameJobAction(T, J, "Priya")).toMatchObject({ ok: false, code: "name_invalid", error: "That name will not do. Use a plain name, without a phone number or a link." });
    api.patchJob.mockRejectedValueOnce(new ApiRequestError(422, "setting_invalid", "x", undefined, undefined, undefined, { fields: ["from_hour"] }));
    expect(await setJobSettingAction(T, J, "from_hour", "10:30")).toMatchObject({ ok: false, code: "setting_invalid", fields: ["from_hour"], error: "That choice was not accepted. Pick another one." });
    api.addJobFaq.mockRejectedValueOnce(new ApiRequestError(422, "faq_not_allowed", "x"));
    expect(await addJobFaqAction(T, J, "Discounts?", "Yes, 20 percent off.")).toMatchObject({ ok: false, code: "faq_not_allowed", error: "A job answer may not promise a price or a discount." });
    api.testJob.mockRejectedValueOnce(new ApiRequestError(409, "quiet_hours", "x"));
    expect(await testJobAction(T, J, "call")).toMatchObject({ ok: false, code: "quiet_hours", error: "Test calls and messages are only sent between 10 am and 9 pm." });
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

describe("JOBS off", () => {
  it("nothing is called: every change answers invalid before the person, the role or the API is asked", async () => {
    vi.stubEnv("JOBS", "");
    const off = { ok: false, kind: "invalid" };
    expect(await renameJobAction(T, J, "Priya")).toMatchObject(off);
    expect(await setJobSettingAction(T, J, "when", "right_away")).toMatchObject(off);
    expect(await setJobFindsOutAction(T, J, "budget", true)).toMatchObject(off);
    expect(await addJobFaqAction(T, J, "Discounts?", "Yes.")).toMatchObject(off);
    expect(await removeJobFaqAction(T, J, "faq-1")).toMatchObject(off);
    expect(await testJobAction(T, J, "whatsapp")).toMatchObject(off);
    expect(requireUser).not.toHaveBeenCalled();
    expect(fetchTenant).not.toHaveBeenCalled();
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
  });
});
