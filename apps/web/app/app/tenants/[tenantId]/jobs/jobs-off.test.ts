import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const setJobEnabled = vi.fn();
vi.mock("@/lib/api/jobs", () => ({ setJobEnabled: (...a: unknown[]) => setJobEnabled(...a) }));
const readSheetLoad = vi.fn();
vi.mock("./sheet-load", () => ({ readSheetLoad: (...a: unknown[]) => readSheetLoad(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { setJobEnabledAction } from "./actions";
import { loadNewJobSheetAction } from "./sheet-actions";

const T = "22222222-2222-4222-8222-222222222222";
const J = "66666666-6666-4666-8666-666666666601";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
  setJobEnabled.mockResolvedValue({ id: J, enabled: false, status: "paused" });
  readSheetLoad.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("the switch of a job and the New job sheet's read", () => {
  it("with JOBS on they work for the Owner", async () => {
    vi.stubEnv("JOBS", "1");
    expect(await setJobEnabledAction(T, J, false)).toMatchObject({ ok: true });
    expect(await loadNewJobSheetAction(T)).toEqual({ ok: true, data: null });
  });
  it("a rejected session on the sheet's read sends the person to sign in (it is not 'no ideas')", async () => {
    vi.stubEnv("JOBS", "1");
    readSheetLoad.mockRejectedValueOnce(new ApiAuthError());
    await expect(loadNewJobSheetAction(T)).rejects.toThrow("REDIRECT /login");
  });
  it("JOBS off: nothing is called (not the person, the role, the API or the read)", async () => {
    vi.stubEnv("JOBS", "");
    expect(await setJobEnabledAction(T, J, false)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await loadNewJobSheetAction(T)).toMatchObject({ ok: false, kind: "invalid" });
    expect(requireUser).not.toHaveBeenCalled();
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(setJobEnabled).not.toHaveBeenCalled();
    expect(readSheetLoad).not.toHaveBeenCalled();
  });
});
