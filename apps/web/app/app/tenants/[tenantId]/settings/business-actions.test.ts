import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const saveProfile = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/profile", async (orig) => ({ ...(await orig<typeof import("@/lib/api/profile")>()), saveProfile: (...a: unknown[]) => saveProfile(...a) }));

import { saveBusinessAction } from "./business-actions";

const T = "22222222-2222-4222-8222-222222222222";
const form = (over: Record<string, string | string[]> = {}) => {
  const f = new FormData();
  const all: Record<string, string | string[]> = { name: "Pavers Corner", town: "Guntur", languages: ["en", "te"], ...over };
  for (const [k, v] of Object.entries(all)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
  saveProfile.mockResolvedValue({});
});

describe("Settings > Business: changing the name, the city and the languages", () => {
  it("saves what was given with the person's token and reads the workspace's pages again so the new name shows at once", async () => {
    expect(await saveBusinessAction(T, undefined, form({ name: "  New Name  " }))).toEqual({ ok: true });
    expect(saveProfile).toHaveBeenCalledWith("tok", T, { name: "New Name", town: "Guntur", languages: ["en", "te"] });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it("an Admin may; the city may be left as it is (not sent) and a language twice is once", async () => {
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await saveBusinessAction(T, undefined, form({ town: "", languages: ["te", "te", "kn"] }))).toEqual({ ok: true });
    expect(saveProfile).toHaveBeenCalledWith("tok", T, { name: "Pavers Corner", languages: ["te", "kn"] });
  });
  it.each([["no name", { name: " " }], ["a one-letter city", { town: "G" }], ["no language", { languages: [] }], ["only languages the API does not know", { languages: ["xx"] }], ["a name over 120 letters", { name: "x".repeat(121) }]])("%s is refused before any request", async (_why, over) => {
    expect(await saveBusinessAction(T, undefined, form(over))).toEqual({ ok: false, error: "invalid" });
    expect(saveProfile).not.toHaveBeenCalled();
  });
  it("Sales and Viewers are refused without a request; the API's 403 is the same answer", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ role });
      expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "role" });
    }
    expect(saveProfile).not.toHaveBeenCalled();
    fetchTenant.mockResolvedValue({ role: "owner" });
    saveProfile.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "role" });
  });
  it("a rejected session asks to sign in; any other failure says it could not save; a bad workspace id is refused", async () => {
    saveProfile.mockRejectedValue(new ApiAuthError());
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "session" });
    saveProfile.mockRejectedValue(new Error("down"));
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "failed" });
    expect(await saveBusinessAction("not-a-uuid", undefined, form())).toEqual({ ok: false, error: "role" });
  });
});
