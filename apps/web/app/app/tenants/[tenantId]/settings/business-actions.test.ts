import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const saveProfile = vi.fn();
const getWorkspaceProfile = vi.fn();
const patchWorkspaceProfile = vi.fn();
const uploadLogo = vi.fn();
const removeLogo = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/profile", async (orig) => ({ ...(await orig<typeof import("@/lib/api/profile")>()), saveProfile: (...a: unknown[]) => saveProfile(...a) }));
vi.mock("@/lib/api/workspace", () => ({
  getWorkspaceProfile: (...a: unknown[]) => getWorkspaceProfile(...a),
  patchWorkspaceProfile: (...a: unknown[]) => patchWorkspaceProfile(...a),
  uploadLogo: (...a: unknown[]) => uploadLogo(...a),
  removeLogo: (...a: unknown[]) => removeLogo(...a),
}));

import { logoAction, saveBusinessAction } from "./business-actions";

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
  patchWorkspaceProfile.mockResolvedValue({});
  getWorkspaceProfile.mockResolvedValue({ type: "hardware", typeLabel: null });
});

describe("Settings > Business: the Owner changes name, city, phone, languages and the kind", () => {
  it("saves what was given with the person's token and reads the workspace's pages again so the new name shows at once", async () => {
    expect(await saveBusinessAction(T, undefined, form({ name: "  New Name  " }))).toEqual({ ok: true });
    expect(patchWorkspaceProfile).toHaveBeenCalledWith("tok", T, { name: "New Name", city: "Guntur", languages: ["en", "te"] });
    expect(saveProfile).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it("an emptied city or phone is cleared (null); a phone left out of the form is kept", async () => {
    await saveBusinessAction(T, undefined, form({ town: "", phone: "" }));
    expect(patchWorkspaceProfile).toHaveBeenLastCalledWith("tok", T, { name: "Pavers Corner", city: null, phone: null, languages: ["en", "te"] });
    await saveBusinessAction(T, undefined, form({ phone: "+91 98765 43210" }));
    expect(patchWorkspaceProfile).toHaveBeenLastCalledWith("tok", T, { name: "Pavers Corner", city: "Guntur", phone: "+91 98765 43210", languages: ["en", "te"] });
  });
  it("the kind is sent only when it changed, so a refusal about the kind never blocks a rename", async () => {
    await saveBusinessAction(T, undefined, form({ type: "hardware" }));
    expect(patchWorkspaceProfile.mock.calls[0][2]).not.toHaveProperty("type");
    await saveBusinessAction(T, undefined, form({ type: "salon" }));
    expect(patchWorkspaceProfile.mock.calls[1][2]).toMatchObject({ type: "salon" });
  });
  it('"Other" sends what the business is, 2 to 60 letters', async () => {
    expect(await saveBusinessAction(T, undefined, form({ type: "other", other_label: "Pet grooming" }))).toEqual({ ok: true });
    expect(patchWorkspaceProfile.mock.calls[0][2]).toMatchObject({ type: "other", type_label: "Pet grooming" });
    expect(await saveBusinessAction(T, undefined, form({ type: "other", other_label: "x" }))).toEqual({ ok: false, error: "invalid" });
  });
  it.each([["pack_data_present", "type_pack_data_present"], ["lead_data_present", "type_lead_data_present"], ["unknown_type", "type_unknown_type"], ["something_new", "failed"]])("a refused change of kind (%s) says why", async (reason, error) => {
    patchWorkspaceProfile.mockRejectedValue(new ApiRequestError(409, "type_change_refused", "x", reason));
    expect(await saveBusinessAction(T, undefined, form({ type: "salon" }))).toEqual({ ok: false, error });
  });
  it.each([["no name", { name: " " }], ["a one-letter city", { town: "G" }], ["no language", { languages: [] }], ["only languages the API does not know", { languages: ["xx"] }], ["a name over 120 letters", { name: "x".repeat(121) }], ["a phone with letters", { phone: "call me" }]])("%s is refused before any request", async (_why, over) => {
    expect(await saveBusinessAction(T, undefined, form(over))).toEqual({ ok: false, error: "invalid" });
    expect(patchWorkspaceProfile).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe("Settings > Business: an Admin, Sales, Viewers and failures", () => {
  it("an Admin saves the name, the city and the languages the older way; the city may be left as it is (not sent) and a language twice is once", async () => {
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await saveBusinessAction(T, undefined, form({ town: "", languages: ["te", "te", "kn"], type: "salon", phone: "12345678" }))).toEqual({ ok: true });
    expect(saveProfile).toHaveBeenCalledWith("tok", T, { name: "Pavers Corner", languages: ["te", "kn"] });
    expect(patchWorkspaceProfile).not.toHaveBeenCalled();
  });
  it("Sales and Viewers are refused without a request; the API's 403 is the same answer", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ role });
      expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "role" });
    }
    expect(saveProfile).not.toHaveBeenCalled();
    expect(patchWorkspaceProfile).not.toHaveBeenCalled();
    fetchTenant.mockResolvedValue({ role: "owner" });
    patchWorkspaceProfile.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "role" });
  });
  it("a rejected session asks to sign in; any other failure says it could not save; a bad workspace id is refused", async () => {
    patchWorkspaceProfile.mockRejectedValue(new ApiAuthError());
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "session" });
    patchWorkspaceProfile.mockRejectedValue(new Error("down"));
    expect(await saveBusinessAction(T, undefined, form())).toEqual({ ok: false, error: "failed" });
    expect(await saveBusinessAction("not-a-uuid", undefined, form())).toEqual({ ok: false, error: "role" });
  });
});

const pic = (type: string, size = 10) => new File([new Uint8Array(size)], "logo", { type });
const logoForm = (file?: File) => {
  const f = new FormData();
  if (file) f.append("logo", file);
  return f;
};

describe("Settings > Business: the logo", () => {
  it("sends the picture as it is, with its own type, and reads the pages again", async () => {
    expect(await logoAction(T, undefined, logoForm(pic("image/png")))).toEqual({ ok: true });
    expect(uploadLogo).toHaveBeenCalledWith("tok", T, expect.any(ArrayBuffer), "image/png");
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it("an Admin may; Sales may not", async () => {
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await logoAction(T, undefined, logoForm(pic("image/webp")))).toEqual({ ok: true });
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await logoAction(T, undefined, logoForm(pic("image/webp")))).toEqual({ ok: false, error: "role" });
  });
  it("no file, a big file or another type is refused before any request", async () => {
    expect(await logoAction(T, undefined, logoForm())).toEqual({ ok: false, error: "invalid" });
    expect(await logoAction(T, undefined, logoForm(pic("image/png", 5 * 1024 * 1024 + 1)))).toEqual({ ok: false, error: "toobig" });
    expect(await logoAction(T, undefined, logoForm(pic("application/pdf")))).toEqual({ ok: false, error: "kind" });
    expect(uploadLogo).not.toHaveBeenCalled();
  });
  it("removing needs no file", async () => {
    const f = new FormData();
    f.append("remove", "1");
    expect(await logoAction(T, undefined, f)).toEqual({ ok: true });
    expect(removeLogo).toHaveBeenCalledWith("tok", T);
  });
  it("the API's own refusals map to the closed sentences", async () => {
    uploadLogo.mockRejectedValue(new ApiRequestError(415, "image_rejected", "x"));
    expect(await logoAction(T, undefined, logoForm(pic("image/png")))).toEqual({ ok: false, error: "kind" });
    uploadLogo.mockRejectedValue(new ApiRequestError(413, "image_too_large", "x"));
    expect(await logoAction(T, undefined, logoForm(pic("image/png")))).toEqual({ ok: false, error: "toobig" });
    uploadLogo.mockRejectedValue(new ApiAuthError());
    expect(await logoAction(T, undefined, logoForm(pic("image/png")))).toEqual({ ok: false, error: "session" });
  });
});
