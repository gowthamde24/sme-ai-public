import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import * as F from "@/lib/api/education-fixtures";

const api = { plan: vi.fn(), assign: vi.fn(), void: vi.fn(), pay: vi.fn(), concede: vi.fn(), adjust: vi.fn(), late: vi.fn() };
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
  putFeePlan: (...a: unknown[]) => api.plan(...a),
  assignFeePlan: (...a: unknown[]) => api.assign(...a),
  voidFeeAssignment: (...a: unknown[]) => api.void(...a),
  putFeePayment: (...a: unknown[]) => api.pay(...a),
  putFeeConcession: (...a: unknown[]) => api.concede(...a),
  putFeeAdjustment: (...a: unknown[]) => api.adjust(...a),
  postLateFees: (...a: unknown[]) => api.late(...a),
}));

import { assignPlanAction, postLateFeesAction, recordFeeEntryAction, saveFeePlanAction, voidAssignmentAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const ENTRY = "ee000000-0000-4000-8000-0000000000f9";
const line = { head: "tuition" as const, instalment_no: 1, due_date: "2026-06-15", amount_paise: 2500000 };
const plan = { name: " Class 5 fees ", programmeId: F.PROGRAMME, groupId: "", academicYear: "2026-27", lateKind: "none" as const, latePaise: null, lateGraceDays: 0, lateCapPaise: null, active: true, lines: [line] };
const entry = (over: object = {}) => ({ entryId: ENTRY, kind: "payment" as const, amount: "5,000", entryDate: "2026-10-14", dueDate: "2026-10-14", invoiceNo: "", reference: "", method: "upi", reasonCode: "", direction: "debit" as const, ...over });
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("fee plans", () => {
  it("saves the plan under the screen's id with the lines as typed", async () => {
    api.plan.mockResolvedValue({ id: F.PLAN });
    expect(await saveFeePlanAction(T, F.PLAN, plan)).toEqual({ ok: true, planId: F.PLAN });
    expect(api.plan).toHaveBeenCalledWith("tok", T, F.PLAN, expect.objectContaining({ name: "Class 5 fees", groupId: null, academicYear: "2026-27", lines: [line] }));
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/fees/plans`);
  });
  it.each([
    ["no name", { name: "  " }], ["a year that does not follow", { academicYear: "2026-28" }], ["no lines", { lines: [] }], ["the same head and number twice", { lines: [line, line] }], ["a line with a zero amount", { lines: [{ ...line, amount_paise: 0 }] }],
    ["a line over the limit", { lines: [{ ...line, amount_paise: 100_000_001 }] }], ["a head that does not exist", { lines: [{ ...line, head: "tea" }] }], ["an impossible due day", { lines: [{ ...line, due_date: "2026-02-30" }] }],
    ["a late fee rule without an amount", { lateKind: "fixed" }], ["an amount with no rule", { latePaise: 100 }], ["a cap on a fixed fee", { lateKind: "fixed", latePaise: 100, lateCapPaise: 500 }], ["60+ grace days", { lateGraceDays: 61 }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveFeePlanAction(T, F.PLAN, { ...plan, ...over } as never)).toMatchObject({ ok: false });
    expect(api.plan).not.toHaveBeenCalled();
  });
  it("a plan a student holds says so in our words", async () => {
    api.plan.mockRejectedValue(refusal(409, "fee_plan_in_use"));
    expect(await saveFeePlanAction(T, F.PLAN, plan)).toEqual({ ok: false, error: expect.stringContaining("Make a copy") });
  });
});

describe("giving and taking off a plan", () => {
  it("assigns under the screen's assignment id and a retry is the API's to answer", async () => {
    api.assign.mockResolvedValue({});
    expect(await assignPlanAction(T, F.STUDENT, F.ASSIGNMENT, F.PLAN)).toEqual({ ok: true });
    expect(api.assign).toHaveBeenCalledWith("tok", T, F.ASSIGNMENT, F.STUDENT, F.PLAN, null);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/fees/students/${F.STUDENT}`);
  });
  it("a student who already has a plan for the year is told so", async () => {
    api.assign.mockRejectedValue(refusal(409, "fee_plan_exists"));
    expect(await assignPlanAction(T, F.STUDENT, F.ASSIGNMENT, F.PLAN)).toEqual({ ok: false, error: expect.stringContaining("already has a fee plan") });
  });
  it("bad ids never leave; a void goes to the assignment", async () => {
    expect(await assignPlanAction(T, "x", F.ASSIGNMENT, F.PLAN)).toMatchObject({ ok: false });
    expect(await voidAssignmentAction(T, F.STUDENT, "x")).toMatchObject({ ok: false });
    api.void.mockResolvedValue({});
    expect(await voidAssignmentAction(T, F.STUDENT, F.ASSIGNMENT)).toEqual({ ok: true });
    expect(api.assign).not.toHaveBeenCalled();
  });
});

describe("money on a student's account", () => {
  it("takes a payment in paise under the entry's own id and returns the receipt number", async () => {
    api.pay.mockResolvedValue({ entry_id: ENTRY, receipt_no: "R/2026-27/000004", replayed: false });
    expect(await recordFeeEntryAction(T, F.STUDENT, entry())).toEqual({ ok: true, receiptNo: "R/2026-27/000004", entryId: ENTRY, replayed: false });
    expect(api.pay).toHaveBeenCalledWith("tok", T, F.STUDENT, ENTRY, { receivedOn: "2026-10-14", amountPaise: 500000, method: "upi", againstEntryId: null });
  });
  it("a concession by amount is paise, by percent a whole number 1 to 100", async () => {
    api.concede.mockResolvedValue({ entry_id: ENTRY, amount_paise: 1, replayed: false });
    await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "concession", reasonCode: "sibling", amount: "200" }));
    expect(api.concede.mock.calls[0][4]).toEqual({ mode: "amount", value: 20000, reasonCode: "sibling", reference: null });
    await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "concession", reasonCode: "merit", amount: "10", mode: "percent" }));
    expect(api.concede.mock.calls[1][4]).toEqual({ mode: "percent", value: 10, reasonCode: "merit", reference: null });
  });
  it.each([["0 percent", "0"], ["101 percent", "101"], ["a fraction", "12.5"], ["a word", "ten"]])("%s never reaches the API", async (_n, amount) => {
    expect(await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "concession", reasonCode: "merit", amount, mode: "percent" }))).toMatchObject({ ok: false });
    expect(api.concede).not.toHaveBeenCalled();
  });
  it("an adjustment up has a due day, an adjustment down has none; a late fee is not a reason a person may give", async () => {
    api.adjust.mockResolvedValue({ entry_id: ENTRY, replayed: false });
    await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "adjustment", reasonCode: "correction", direction: "debit", dueDate: "2026-11-01" }));
    expect(api.adjust.mock.calls[0][4]).toMatchObject({ direction: "debit", dueDate: "2026-11-01" });
    await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "adjustment", reasonCode: "waiver", direction: "credit" }));
    expect(api.adjust.mock.calls[1][4]).toMatchObject({ direction: "credit", dueDate: null });
    expect(await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "adjustment", reasonCode: "late_fee", direction: "debit", dueDate: "2026-11-01" }))).toMatchObject({ ok: false });
    expect(await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "adjustment", reasonCode: "correction", direction: "debit", dueDate: "2026-10-01" }))).toMatchObject({ ok: false });
    expect(api.adjust).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["a charge (charges come from a plan)", { kind: "charge" }], ["an amount under one rupee", { amount: "0.50" }], ["an amount that is not a number", { amount: "lots" }], ["a method that does not exist", { method: "barter" }],
    ["an impossible day", { entryDate: "2026-02-30" }], ["a bad entry id", { entryId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await recordFeeEntryAction(T, F.STUDENT, entry(over as never))).toMatchObject({ ok: false, error: expect.any(String) });
    expect(api.pay).not.toHaveBeenCalled();
    expect(api.concede).not.toHaveBeenCalled();
    expect(api.adjust).not.toHaveBeenCalled();
  });
  it("a concession without the second factor points at the Security page; a Viewer's call is refused by the API in plain words", async () => {
    api.concede.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await recordFeeEntryAction(T, F.STUDENT, entry({ kind: "concession", reasonCode: "merit", amount: "100" }))).toMatchObject({ ok: false, mfa: true });
    api.pay.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await recordFeeEntryAction(T, F.STUDENT, entry())).toEqual({ ok: false, error: expect.not.stringContaining("API's own") });
    api.pay.mockRejectedValueOnce(new ApiAuthError());
    await expect(recordFeeEntryAction(T, F.STUDENT, entry())).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("late fees", () => {
  it("posts and says how many and how much", async () => {
    api.late.mockResolvedValue({ as_of: "2026-10-14", posted: 2, total_paise: 40000 });
    expect(await postLateFeesAction(T)).toEqual({ ok: true, posted: 2, totalPaise: 40000 });
    expect(await postLateFeesAction("x")).toMatchObject({ ok: false });
    api.late.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await postLateFeesAction(T)).toMatchObject({ ok: false, mfa: true });
  });
});
