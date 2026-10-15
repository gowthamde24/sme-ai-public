import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseAdmissionCreated, parseAdmitted } from "@/lib/api/education";
import * as F from "@/lib/api/education-fixtures";

const api = { put: vi.fn(), stage: vi.fn(), admit: vi.fn() };
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/education", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/education")>()),
  putAdmission: (...a: unknown[]) => api.put(...a),
  setAdmissionStage: (...a: unknown[]) => api.stage(...a),
  admit: (...a: unknown[]) => api.admit(...a),
}));

import { admissionStageAction, admitAction, saveAdmissionAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const fresh = { source: "walk_in", programmeId: F.PROGRAMME, contactId: "", guardianName: " Ravi Kumar ", guardianPhone: "+00 11111 11111" };
const admitInput = { studentId: F.STUDENT, isAdult: false, childLabel: " Asha ", programmeId: F.PROGRAMME, groupId: F.GROUP, admissionNo: "", planId: F.PLAN, assignmentId: F.ASSIGNMENT, joinedOn: "2026-10-14" };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("starting an enquiry", () => {
  it("a new guardian: a name and a number, no contact id", async () => {
    api.put.mockResolvedValue(parseAdmissionCreated(F.ADMISSION_CREATED_JSON));
    expect(await saveAdmissionAction(T, F.ADMISSION, fresh)).toEqual({ ok: true, admissionId: F.ADMISSION });
    expect(api.put).toHaveBeenCalledWith("tok", T, F.ADMISSION, { source: "walk_in", programmeId: F.PROGRAMME, contactId: null, guardianName: "Ravi Kumar", guardianPhone: "+00 11111 11111" });
  });
  it("an existing guardian: a contact id and no name or number", async () => {
    api.put.mockResolvedValue(parseAdmissionCreated(F.ADMISSION_CREATED_JSON));
    await saveAdmissionAction(T, F.ADMISSION, { ...fresh, contactId: F.GUARDIAN, guardianName: "", guardianPhone: "" });
    expect(api.put.mock.calls[0][3]).toMatchObject({ contactId: F.GUARDIAN, guardianName: null, guardianPhone: null });
  });
  it.each([
    ["both a contact and a new name", { contactId: F.GUARDIAN }], ["a name with no number", { guardianPhone: "" }], ["a number with letters", { guardianPhone: "call me" }], ["a source that does not exist", { source: "billboard" }],
    ["a bad programme id", { programmeId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveAdmissionAction(T, F.ADMISSION, { ...fresh, ...over })).toMatchObject({ ok: false });
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("moving an enquiry", () => {
  it("forward, lost with a reason, or back to the start", async () => {
    api.stage.mockResolvedValue({});
    expect(await admissionStageAction(T, F.ADMISSION, "application", null)).toEqual({ ok: true });
    expect(await admissionStageAction(T, F.ADMISSION, "lost", "fees")).toEqual({ ok: true });
    expect(await admissionStageAction(T, F.ADMISSION, "enquiry", null)).toEqual({ ok: true });
    expect(api.stage.mock.calls.map((c) => [c[3], c[4]])).toEqual([["application", null], ["lost", "fees"], ["enquiry", null]]);
  });
  it.each([["lost without a reason", "lost", null], ["a reason that is not a reason", "lost", "bored"], ["a reason on a move forward", "application", "fees"], ["admitted (only admitting does that)", "admitted", null]])("%s never reaches the API", async (_n, stage, reason) => {
    expect(await admissionStageAction(T, F.ADMISSION, stage as never, reason)).toMatchObject({ ok: false });
    expect(api.stage).not.toHaveBeenCalled();
  });
  it("a move the API will not make is a plain sentence", async () => {
    api.stage.mockRejectedValue(refusal(409, "admission_stage"));
    expect(await admissionStageAction(T, F.ADMISSION, "application", null)).toEqual({ ok: false, error: expect.stringContaining("cannot move that way") });
  });
});

describe("admitting", () => {
  it("makes the student and gives the plan in one call, with the screen's two ids", async () => {
    api.admit.mockResolvedValue(parseAdmitted(F.ADMITTED_JSON));
    expect(await admitAction(T, F.ADMISSION, admitInput)).toEqual({ ok: true, studentId: F.STUDENT });
    expect(api.admit).toHaveBeenCalledWith("tok", T, F.ADMISSION, expect.objectContaining({ studentId: F.STUDENT, childLabel: "Asha", planId: F.PLAN, assignmentId: F.ASSIGNMENT, groupId: F.GROUP, admissionNo: null }));
  });
  it("without a plan sends neither half of the pair", async () => {
    api.admit.mockResolvedValue(parseAdmitted(F.ADMITTED_JSON));
    await admitAction(T, F.ADMISSION, { ...admitInput, planId: "", assignmentId: "" });
    expect(api.admit.mock.calls[0][3]).toMatchObject({ planId: null, assignmentId: null });
  });
  it.each([["a label with a digit", { childLabel: "Asha5" }], ["no label for a child", { childLabel: "" }], ["a label for an adult", { isAdult: true }], ["a plan with no assignment id", { assignmentId: "" }], ["a bad student id", { studentId: "x" }], ["an impossible joining day", { joinedOn: "2026-02-30" }]])("%s never reaches the API", async (_n, over) => {
    expect(await admitAction(T, F.ADMISSION, { ...admitInput, ...over })).toMatchObject({ ok: false });
    expect(api.admit).not.toHaveBeenCalled();
  });
});
