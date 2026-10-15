import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseStudentSaved } from "@/lib/api/education";
import * as F from "@/lib/api/education-fixtures";

const api = { put: vi.fn(), status: vi.fn(), erase: vi.fn() };
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
  putStudent: (...a: unknown[]) => api.put(...a),
  setStudentStatus: (...a: unknown[]) => api.status(...a),
  eraseStudent: (...a: unknown[]) => api.erase(...a),
}));

import { eraseStudentAction, saveStudentAction, studentStatusAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const input = { contactId: F.GUARDIAN, isAdult: false, childLabel: " Asha ", programmeId: F.PROGRAMME, groupId: F.GROUP, admissionNo: "A-1001", joinedOn: "2026-06-10" };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("saving a student: the minimum and nothing else", () => {
  it("sends the trimmed label, the placement and nothing more", async () => {
    api.put.mockResolvedValue(parseStudentSaved(F.STUDENT_SAVED_JSON));
    expect(await saveStudentAction(T, F.STUDENT, input)).toEqual({ ok: true, studentId: F.STUDENT });
    expect(api.put).toHaveBeenCalledWith("tok", T, F.STUDENT, { contactId: F.GUARDIAN, isAdult: false, childLabel: "Asha", programmeId: F.PROGRAMME, groupId: F.GROUP, admissionNo: "A-1001", guardianContactId: null, joinedOn: "2026-06-10" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/students`);
  });
  it("an adult student sends no label, and empty boxes are nothing", async () => {
    api.put.mockResolvedValue(parseStudentSaved(F.STUDENT_SAVED_JSON));
    await saveStudentAction(T, F.STUDENT, { ...input, isAdult: true, childLabel: "", groupId: "", admissionNo: "", joinedOn: "" });
    expect(api.put.mock.calls[0][3]).toMatchObject({ isAdult: true, childLabel: null, groupId: null, admissionNo: null, joinedOn: null });
  });
  it.each([
    ["a label with a digit", { childLabel: "Asha5" }], ["a label with an @", { childLabel: "asha@school" }], ["a label of 31 letters", { childLabel: "a".repeat(31) }], ["no label for a child", { childLabel: " " }],
    ["a label for an adult student", { isAdult: true, childLabel: "Asha" }], ["an admission number with a space", { admissionNo: "A 1" }], ["an admission number of 31 characters", { admissionNo: "A".repeat(31) }], ["a day that is not one", { joinedOn: "2026-02-30" }],
    ["a bad guardian id", { contactId: "x" }], ["a bad programme id", { programmeId: "x" }], ["a bad section id", { groupId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveStudentAction(T, F.STUDENT, { ...input, ...over } as never)).toEqual({ ok: false, error: "That was not accepted. Check the details and try again. Nothing was changed." });
    expect(api.put).not.toHaveBeenCalled();
  });
  it("another student's admission number is a plain sentence that does not say whose", async () => {
    api.put.mockRejectedValue(refusal(409, "admission_no_used"));
    expect(await saveStudentAction(T, F.STUDENT, input)).toEqual({ ok: false, error: "That admission number belongs to another student." });
  });
  it("a rejected session goes to sign-in", async () => {
    api.put.mockRejectedValue(new ApiAuthError());
    await expect(saveStudentAction(T, F.STUDENT, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("leaving and erasing", () => {
  it("marks a student as left on a real day, or back with no day", async () => {
    api.status.mockResolvedValue({});
    expect(await studentStatusAction(T, F.STUDENT, "left", "2026-09-30")).toEqual({ ok: true });
    expect(api.status).toHaveBeenCalledWith("tok", T, F.STUDENT, "left", "2026-09-30");
    expect(await studentStatusAction(T, F.STUDENT, "active", null)).toEqual({ ok: true });
  });
  it.each([["left without a day", "left", null], ["left on an impossible day", "left", "2026-02-30"], ["back with a day", "active", "2026-09-30"], ["a status that does not exist", "gone", null]])("%s never reaches the API", async (_n, status, day) => {
    expect(await studentStatusAction(T, F.STUDENT, status as never, day)).toMatchObject({ ok: false });
    expect(api.status).not.toHaveBeenCalled();
  });
  it("erasing one child needs the second factor and says so", async () => {
    api.erase.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await eraseStudentAction(T, F.STUDENT)).toMatchObject({ ok: false, mfa: true });
    api.erase.mockResolvedValueOnce({ erased: true, replayed: false });
    expect(await eraseStudentAction(T, F.STUDENT)).toEqual({ ok: true });
    expect(await eraseStudentAction(T, "x")).toMatchObject({ ok: false });
  });
});
