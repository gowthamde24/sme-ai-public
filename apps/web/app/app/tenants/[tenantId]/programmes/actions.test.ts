import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import * as F from "@/lib/api/education-fixtures";

const api = { profile: vi.fn(), programme: vi.fn(), group: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/education", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/education")>()),
  putInstitutionProfile: (...a: unknown[]) => api.profile(...a),
  putProgramme: (...a: unknown[]) => api.programme(...a),
  putGroup: (...a: unknown[]) => api.group(...a),
}));

import { saveGroupAction, saveProfileAction, saveProgrammeAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const profile = { institutionType: "school", yearStartMonth: 6, terms: [{ label: "Term 1", start_month: 6, end_month: 9 }], parentLanguages: ["en", "te"], retentionMonths: null };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("the institution", () => {
  it("saves what the form shows, and the retention months only when they are given", async () => {
    api.profile.mockResolvedValue({});
    expect(await saveProfileAction(T, profile)).toEqual({ ok: true });
    expect(api.profile).toHaveBeenCalledWith("tok", T, { institutionType: "school", yearStartMonth: 6, terms: profile.terms, parentLanguages: ["en", "te"], retentionMonths: null });
    await saveProfileAction(T, { ...profile, retentionMonths: 24 });
    expect(api.profile.mock.calls[1][2].retentionMonths).toBe(24);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/programmes`);
  });
  it.each([
    ["a kind of institution that does not exist", { institutionType: "factory" }], ["month 13", { yearStartMonth: 13 }], ["seven terms", { terms: Array.from({ length: 7 }, () => ({ label: "T", start_month: 1, end_month: 2 })) }],
    ["a term with no name", { terms: [{ label: " ", start_month: 1, end_month: 2 }] }], ["no language", { parentLanguages: [] }], ["a language twice", { parentLanguages: ["en", "en"] }], ["a language that is not offered", { parentLanguages: ["fr"] }],
    ["0 months of retention", { retentionMonths: 0 }], ["241 months", { retentionMonths: 241 }], ["1.5 months", { retentionMonths: 1.5 }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveProfileAction(T, { ...profile, ...over } as never)).toEqual({ ok: false, error: "That was not accepted. Check the details and try again. Nothing was changed." });
    expect(api.profile).not.toHaveBeenCalled();
  });
  it("a refusal is OUR sentence; a missing second factor points at the Security page; a rejected session goes to sign-in", async () => {
    api.profile.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await saveProfileAction(T, { ...profile, retentionMonths: 12 })).toMatchObject({ ok: false, mfa: true, error: expect.not.stringContaining("API's own") });
    api.profile.mockRejectedValueOnce(refusal(403, "module_off"));
    expect(await saveProfileAction(T, profile)).toMatchObject({ ok: false, error: expect.stringContaining("not part of") });
    api.profile.mockRejectedValueOnce(new ApiAuthError());
    await expect(saveProfileAction(T, profile)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("programmes and sections", () => {
  it("saves a programme and a section under the screen's ids", async () => {
    api.programme.mockResolvedValue({});
    api.group.mockResolvedValue({});
    expect(await saveProgrammeAction(T, F.PROGRAMME, { name: " Class 5 ", kind: "class", groupKind: "section", active: true })).toEqual({ ok: true });
    expect(api.programme).toHaveBeenCalledWith("tok", T, F.PROGRAMME, { name: "Class 5", kind: "class", groupKind: "section", active: true });
    expect(await saveGroupAction(T, F.PROGRAMME, F.GROUP, { label: "A", timing: null, active: true })).toEqual({ ok: true });
    expect(api.group).toHaveBeenCalledWith("tok", T, F.PROGRAMME, F.GROUP, { label: "A", timing: null, active: true });
  });
  it.each([["no name", { name: "  " }], ["a kind that does not exist", { kind: "house" }], ["a way of dividing that does not exist", { groupKind: "house" }], ["a name of 81 letters", { name: "n".repeat(81) }]])("%s never reaches the API", async (_n, over) => {
    expect(await saveProgrammeAction(T, F.PROGRAMME, { name: "X", kind: "class", groupKind: "none", active: true, ...over } as never)).toMatchObject({ ok: false });
    expect(api.programme).not.toHaveBeenCalled();
  });
  it("a bad id or an empty section name never reaches the API", async () => {
    expect(await saveProgrammeAction(T, "x", { name: "X", kind: "class", groupKind: "none", active: true })).toMatchObject({ ok: false });
    expect(await saveGroupAction(T, F.PROGRAMME, "x", { label: "A", timing: null, active: true })).toMatchObject({ ok: false });
    expect(await saveGroupAction(T, F.PROGRAMME, F.GROUP, { label: " ", timing: null, active: true })).toMatchObject({ ok: false });
    expect(api.programme).not.toHaveBeenCalled();
    expect(api.group).not.toHaveBeenCalled();
  });
});
