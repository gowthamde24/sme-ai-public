import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const api = { patchJob: vi.fn() };
vi.mock("@/lib/api/jobs", () => ({ patchJob: (...a: unknown[]) => api.patchJob(...a), addJobFaq: vi.fn(), removeJobFaq: vi.fn(), testJob: vi.fn() }));

import { speaksPatch } from "@/lib/jobs/who";

import { setJobSpeaksAction } from "./actions";

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

describe("Who talks: the change of how a job sounds (Owner and Admin only)", () => {
  it("asks the API with exactly the patch the adapter defines", async () => {
    expect(await setJobSpeaksAction(T, J, speaksPatch("tone", "casual"))).toEqual({ ok: true, data: patched });
    expect(api.patchJob).toHaveBeenCalledWith("tok", T, J, { speaks: { tone: "casual" } });
    await setJobSpeaksAction(T, J, { language: "te" });
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { speaks: { language: "te" } });
  });
  it("closed words only: anything else never reaches the API", async () => {
    for (const bad of [{}, { language: "fr" }, { voice: "own_voice" }, { tone: "casual", x: 1 }, null, "te", ["te"]]) expect(await setJobSpeaksAction(T, J, bad)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await setJobSpeaksAction(T, "not-a-uuid", { tone: "casual" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.patchJob).not.toHaveBeenCalled();
  });
  it("Sales and Viewer are refused", async () => {
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await setJobSpeaksAction(T, J, { tone: "casual" })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(api.patchJob).not.toHaveBeenCalled();
  });
});

describe("JOBS off", () => {
  it("Who talks changes nothing: invalid, and the person, the role and the API are not asked", async () => {
    vi.stubEnv("JOBS", "");
    expect(await setJobSpeaksAction(T, J, speaksPatch("tone", "casual"))).toMatchObject({ ok: false, kind: "invalid" });
    expect(requireUser).not.toHaveBeenCalled();
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(api.patchJob).not.toHaveBeenCalled();
  });
});
