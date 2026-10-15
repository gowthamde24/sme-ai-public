import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import {
  admit, assignFeePlan, eraseStudent, getFeePlan, getFeeReceipt, getGuardianFees, getInstitutionProfile, getLateFeesPreview, getStudentFeeEntries, getStudentFees, listAdmissions, listFeePlans, listPending, listProgrammes, listStudents, parseAdmissionDetail,
  parseFeeEntries, parseFeePlan, parseFeeReceipt, parseFeeStatement, parseGuardianFees, parsePending, parseProfile, parseProgramme, parseStudent, postLateFees, putAnnouncementAudience, putFeeAdjustment, putFeeConcession, putFeePayment, putFeePlan,
  putGroup, putInstitutionProfile, putProgramme, putStudent, setAdmissionStage, setStudentStatus, putAdmission,
} from "./education";
import * as F from "./education-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
const base = `/v1/tenants/${T}/institution`;
const body = (n = 0) => JSON.parse((apiRequest.mock.calls[n][2] as { body: string }).body);
beforeEach(() => vi.clearAllMocks());

describe("what the API sends", () => {
  it("reads the institution, with or without a profile yet", () => {
    expect(parseProfile(F.PROFILE_JSON)).toMatchObject({ configured: true, institution_type: "school", year_start_month: 6, parent_languages: ["en", "te"], terms: [{ label: "Term 1" }, { label: "Term 2" }] });
    expect(parseProfile(F.PROFILE_NONE_JSON)).toMatchObject({ configured: false, institution_type: null, terms: [] });
    expect(() => parseProfile({ ...F.PROFILE_JSON, institution_type: "factory" })).toThrow(ApiContractError);
    expect(() => parseProfile({ ...F.PROFILE_JSON, year_start_month: 13 })).toThrow(ApiContractError);
  });
  it("reads programmes with their sections and how many students each holds", () => {
    expect(parseProgramme(F.PROGRAMMES_JSON.items[0])).toMatchObject({ name: "Class 5 (synthetic)", group_kind: "section", students: 31, groups: [{ label: "A", students: 16 }, { label: "B" }] });
    expect(() => parseProgramme({ ...F.PROGRAMMES_JSON.items[0], group_kind: "house" })).toThrow(ApiContractError);
  });
  it("reads the minimum student: a first name, a placement, the adult; an erased one has no name", () => {
    expect(parseStudent(F.STUDENT_JSON)).toMatchObject({ display_name: "Asha (synthetic)", programme_name: "Class 5 (synthetic)", group_label: "A", admission_no: "A-1001", status: "active", erased: false });
    expect(parseStudent(F.STUDENT_ERASED_JSON)).toMatchObject({ display_name: null, admission_no: null, erased: true });
    expect(parseStudent(F.STUDENT_LEFT_JSON)).toMatchObject({ status: "left", left_on: "2026-09-30" });
    for (const [k, v] of [["status", "gone"], ["joined_on", "June"], ["programme_id", "x"], ["is_adult", "no"]] as const) expect(() => parseStudent({ ...F.STUDENT_JSON, [k]: v })).toThrow(ApiContractError);
  });
  it("reads an admission with its history", () => {
    expect(parseAdmissionDetail(F.ADMISSION_DETAIL_JSON)).toMatchObject({ stage: "campus_visit", events: [{ stage: "enquiry" }, { stage: "campus_visit" }] });
    expect(() => parseAdmissionDetail({ ...F.ADMISSION_DETAIL_JSON, stage: "enrolled" })).toThrow(ApiContractError);
    expect(() => parseAdmissionDetail({ ...F.ADMISSION_DETAIL_JSON, source: "billboard" })).toThrow(ApiContractError);
  });
  it("reads a fee plan with its instalments", () => {
    expect(parseFeePlan(F.PLAN_DETAIL_JSON)).toMatchObject({ academic_year: "2026-27", late_fee_kind: "fixed", total_paise: 6200000, assigned: 31, lines: [{ head: "tuition", instalment_no: 1 }, {}, {}, { head: "transport" }] });
    expect(() => parseFeePlan({ ...F.PLAN_DETAIL_JSON, lines: [{ head: "tea", instalment_no: 1, due_date: "2026-06-15", amount_paise: 100 }] })).toThrow(ApiContractError);
  });
  it("reads a student's fee statement with the ledger's own statement and the plan they hold", () => {
    const s = parseFeeStatement(F.FEE_STATEMENT_JSON);
    expect(s.assignment).toMatchObject({ plan_name: "Class 5 fees 2026-27 (synthetic)" });
    expect(s.statement).toMatchObject({ outstanding_paise: 1300000, concessions_paise: 200000, open_invoices: [{ reference: "Tuition 2", open_paise: 1300000 }] });
    expect(parseFeeStatement({ ...F.FEE_STATEMENT_JSON, assignment: null }).assignment).toBeNull();
  });
  it("reads fee entries and a receipt, and refuses what is not an entry", () => {
    expect(parseFeeEntries(F.FEE_ENTRIES_JSON).entries.map((e) => e.kind)).toEqual(["payment", "charge", "charge", "concession"]);
    expect(parseFeeReceipt(F.FEE_RECEIPT_JSON)).toMatchObject({ receipt_no: "R/2026-27/000003", balance_after_paise: 1500000, student: { display_name: "Asha (synthetic)" } });
    expect(() => parseFeeEntries({ ...F.FEE_ENTRIES_JSON, entries: [{ ...F.FEE_ENTRIES_JSON.entries[0], method: "barter" }] })).toThrow(ApiContractError);
  });
  it("reads a guardian's total over their children and the pending list with its cursor", () => {
    expect(parseGuardianFees(F.GUARDIAN_FEES_JSON)).toMatchObject({ outstanding_paise: 3700000, students: [{ display_name: "Asha (synthetic)" }, { overdue_paise: 900000 }] });
    expect(parsePending(F.PENDING_JSON)).toMatchObject({ items: [{ pending_paise: 900000, overdue_days: 12 }, {}], next_cursor: expect.stringContaining("p:") });
    expect(() => parsePending({ ...F.PENDING_JSON, items: [{ ...F.PENDING_JSON.items[0], pending_paise: -1 }] })).toThrow(ApiContractError);
  });
});

describe("what is asked of the API", () => {
  it("reads the profile and the programmes under the institution path", async () => {
    apiRequest.mockResolvedValueOnce(F.PROFILE_JSON).mockResolvedValueOnce(F.PROGRAMMES_JSON);
    await getInstitutionProfile("tok", T);
    await listProgrammes("tok", T, { includeInactive: true });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/profile`);
    expect(apiRequest.mock.calls[1][0]).toBe(`${base}/programmes?include_inactive=true`);
  });
  it("saves the profile; the retention months go only when they are given, so a person who cannot set them never switches the rule off by accident here", async () => {
    apiRequest.mockResolvedValue(F.PROFILE_JSON);
    await putInstitutionProfile("tok", T, { institutionType: "school", yearStartMonth: 6, terms: [], parentLanguages: ["en"] });
    expect(body()).toEqual({ institution_type: "school", year_start_month: 6, terms: [], parent_languages: ["en"] });
    await putInstitutionProfile("tok", T, { institutionType: "school", yearStartMonth: 6, terms: [], parentLanguages: ["en"], retentionMonths: 24 });
    expect(body(1).student_retention_months).toBe(24);
  });
  it("saves a programme and a section by their ids", async () => {
    apiRequest.mockResolvedValueOnce(F.PROGRAMME_SAVED_JSON).mockResolvedValueOnce(F.GROUP_SAVED_JSON);
    await putProgramme("tok", T, F.PROGRAMME, { name: "Class 5", kind: "class", groupKind: "section", active: true });
    await putGroup("tok", T, F.PROGRAMME, F.GROUP, { label: "A", timing: null, active: true });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/programmes/${F.PROGRAMME}`);
    expect(body(0)).toEqual({ name: "Class 5", kind: "class", group_kind: "section", active: true });
    expect(apiRequest.mock.calls[1][0]).toBe(`${base}/programmes/${F.PROGRAMME}/groups/${F.GROUP}`);
  });
  it("lists students with the filters and puts only the minimum into a save", async () => {
    apiRequest.mockResolvedValue(F.STUDENT_LIST_JSON);
    await listStudents("tok", T, { programmeId: F.PROGRAMME, status: "active", after: "c1" });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/students?programme_id=${F.PROGRAMME}&status=active&after=c1&limit=50`);
    apiRequest.mockResolvedValue(F.STUDENT_SAVED_JSON);
    await putStudent("tok", T, F.STUDENT, { contactId: F.GUARDIAN, isAdult: false, childLabel: "Asha", programmeId: F.PROGRAMME, groupId: F.GROUP, admissionNo: "A-1001", guardianContactId: null, joinedOn: "2026-06-10" });
    expect(Object.keys(body(1)).sort()).toEqual(["admission_no", "child_label", "contact_id", "group_id", "is_adult", "joined_on", "programme_id"]);
  });
  it("an adult student has no label; a status change and an erase go to their own paths", async () => {
    apiRequest.mockResolvedValue(F.STUDENT_SAVED_JSON);
    await putStudent("tok", T, F.STUDENT, { contactId: F.GUARDIAN, isAdult: true, childLabel: null, programmeId: F.PROGRAMME, groupId: null, admissionNo: null, guardianContactId: null, joinedOn: null });
    expect(body()).toEqual({ contact_id: F.GUARDIAN, is_adult: true, programme_id: F.PROGRAMME });
    apiRequest.mockResolvedValueOnce(F.STUDENT_LEFT_JSON);
    await setStudentStatus("tok", T, F.STUDENT2, "left", "2026-09-30");
    expect(body(1)).toEqual({ status: "left", left_on: "2026-09-30" });
    apiRequest.mockResolvedValueOnce({ student_id: F.STUDENT2, erased: true, replayed: false });
    expect(await eraseStudent("tok", T, F.STUDENT2)).toEqual({ erased: true, replayed: false });
    expect(apiRequest.mock.calls[2][0]).toBe(`${base}/students/${F.STUDENT2}/erase`);
  });
  it("starts an enquiry with a new guardian, moves it and admits with a plan in one go", async () => {
    apiRequest.mockResolvedValueOnce(F.ADMISSION_CREATED_JSON).mockResolvedValueOnce(F.STAGE_CHANGED_JSON).mockResolvedValueOnce(F.ADMITTED_JSON);
    await putAdmission("tok", T, F.ADMISSION, { source: "walk_in", programmeId: F.PROGRAMME, contactId: null, guardianName: "Ravi Kumar", guardianPhone: "+00 11111 11111" });
    expect(body(0)).toEqual({ source: "walk_in", programme_id: F.PROGRAMME, guardian_name: "Ravi Kumar", guardian_phone: "+00 11111 11111" });
    await setAdmissionStage("tok", T, F.ADMISSION, "lost", "fees");
    expect(body(1)).toEqual({ stage: "lost", lost_reason: "fees" });
    await admit("tok", T, F.ADMISSION, { studentId: F.STUDENT, isAdult: false, childLabel: "Asha", programmeId: F.PROGRAMME, groupId: null, admissionNo: null, planId: F.PLAN, assignmentId: F.ASSIGNMENT, joinedOn: null });
    expect(body(2)).toMatchObject({ plan_id: F.PLAN, assignment_id: F.ASSIGNMENT });
  });
  it("admitting without a plan sends neither half of the pair", async () => {
    apiRequest.mockResolvedValue(F.ADMITTED_JSON);
    await admit("tok", T, F.ADMISSION, { studentId: F.STUDENT, isAdult: false, childLabel: "Asha", programmeId: F.PROGRAMME, groupId: null, admissionNo: null, planId: F.PLAN, assignmentId: null, joinedOn: null });
    expect(body()).not.toHaveProperty("plan_id");
    expect(body()).not.toHaveProperty("assignment_id");
  });
  it("lists admissions and plans with their filters", async () => {
    apiRequest.mockResolvedValueOnce(F.ADMISSIONS_JSON).mockResolvedValueOnce(F.PLAN_LIST_JSON).mockResolvedValueOnce(F.PLAN_DETAIL_JSON);
    await listAdmissions("tok", T, { stage: "lost", source: "ad" });
    await listFeePlans("tok", T, { programmeId: F.PROGRAMME });
    await getFeePlan("tok", T, F.PLAN);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/admissions?stage=lost&source=ad&limit=100`);
    expect(apiRequest.mock.calls[1][0]).toBe(`${base}/fee-plans?programme_id=${F.PROGRAMME}`);
    expect(apiRequest.mock.calls[2][0]).toBe(`${base}/fee-plans/${F.PLAN}`);
  });
  it("saves a plan: the late fee is sent only for a late-fee rule", async () => {
    apiRequest.mockResolvedValue(F.PLAN_DETAIL_JSON);
    const lines = [{ head: "tuition" as const, instalment_no: 1, due_date: "2026-06-15", amount_paise: 2500000 }];
    await putFeePlan("tok", T, F.PLAN, { name: "P", programmeId: F.PROGRAMME, groupId: null, academicYear: "2026-27", lateKind: "none", latePaise: 100, lateGraceDays: 0, lateCapPaise: null, active: true, lines });
    expect(body()).not.toHaveProperty("late_fee_paise");
    await putFeePlan("tok", T, F.PLAN, { name: "P", programmeId: F.PROGRAMME, groupId: F.GROUP, academicYear: "2026-27", lateKind: "per_day", latePaise: 5000, lateGraceDays: 3, lateCapPaise: 100000, active: true, lines });
    expect(body(1)).toMatchObject({ group_id: F.GROUP, late_fee_kind: "per_day", late_fee_paise: 5000, late_fee_cap_paise: 100000, late_fee_grace_days: 3 });
  });
  it("assigns a plan to a student under the page's id and reads their fees", async () => {
    apiRequest.mockResolvedValueOnce({ assignment_id: F.ASSIGNMENT, student_id: F.STUDENT, plan_id: F.PLAN, charges: 4, total_paise: 6200000, replayed: false }).mockResolvedValueOnce(F.FEE_STATEMENT_JSON).mockResolvedValueOnce(F.FEE_ENTRIES_JSON);
    await assignFeePlan("tok", T, F.ASSIGNMENT, F.STUDENT, F.PLAN, null);
    await getStudentFees("tok", T, F.STUDENT, "2026-10-14");
    await getStudentFeeEntries("tok", T, F.STUDENT);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/fee-assignments/${F.ASSIGNMENT}`);
    expect(body(0)).toEqual({ student_id: F.STUDENT, plan_id: F.PLAN });
    expect(apiRequest.mock.calls[1][0]).toBe(`${base}/students/${F.STUDENT}/fees?as_of=2026-10-14`);
    expect(apiRequest.mock.calls[2][0]).toBe(`${base}/students/${F.STUDENT}/fees/entries?limit=100`);
  });
  it("records a payment, a concession and an adjustment under the entry's own id", async () => {
    apiRequest.mockResolvedValueOnce({ entry_id: F.FEE_PAYMENT, receipt_no: "R/2026-27/000004", replayed: false }).mockResolvedValueOnce({ entry_id: F.FEE_CHARGE, amount_paise: 100000, replayed: false }).mockResolvedValueOnce({ entry_id: F.FEE_CHARGE, replayed: true });
    expect(await putFeePayment("tok", T, F.STUDENT, F.FEE_PAYMENT, { receivedOn: "2026-10-14", amountPaise: 500000, method: "cash", againstEntryId: null })).toEqual({ entry_id: F.FEE_PAYMENT, receipt_no: "R/2026-27/000004", replayed: false });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/students/${F.STUDENT}/payments/${F.FEE_PAYMENT}`);
    expect(body(0)).toEqual({ received_on: "2026-10-14", amount_paise: 500000, method: "cash" });
    await putFeeConcession("tok", T, F.STUDENT, F.FEE_CHARGE, { mode: "percent", value: 10, reasonCode: "sibling", reference: null });
    expect(body(1)).toEqual({ mode: "percent", value: 10, reason_code: "sibling" });
    expect(await putFeeAdjustment("tok", T, F.STUDENT, F.FEE_CHARGE, { direction: "debit", amountPaise: 1000, reasonCode: "correction", dueDate: "2026-11-01", reference: "Fix 1" })).toEqual({ entry_id: F.FEE_CHARGE, replayed: true });
    expect(body(2)).toEqual({ direction: "debit", amount_paise: 1000, reason_code: "correction", due_date: "2026-11-01", reference: "Fix 1" });
  });
  it("reads a receipt, a guardian's fees, the late fees and posts them, and lists the pending", async () => {
    apiRequest.mockResolvedValueOnce(F.FEE_RECEIPT_JSON).mockResolvedValueOnce(F.GUARDIAN_FEES_JSON).mockResolvedValueOnce(F.LATE_FEES_JSON).mockResolvedValueOnce(F.LATE_FEES_POSTED_JSON).mockResolvedValueOnce(F.PENDING_JSON);
    await getFeeReceipt("tok", T, F.FEE_PAYMENT);
    await getGuardianFees("tok", T, F.GUARDIAN);
    expect((await getLateFeesPreview("tok", T)).count).toBe(2);
    expect((await postLateFees("tok", T)).posted).toBe(2);
    await listPending("tok", T, { programmeId: F.PROGRAMME, after: "c" });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/receipts/${F.FEE_PAYMENT}`);
    expect(apiRequest.mock.calls[3][2]).toMatchObject({ method: "POST" });
    expect(apiRequest.mock.calls[4][0]).toBe(`${base}/fees/pending?programme_id=${F.PROGRAMME}&after=c&limit=50`);
  });
  it("builds a school announcement's audience for all, a programme or a section", async () => {
    apiRequest.mockResolvedValue(F.AUDIENCE_JSON);
    await putAnnouncementAudience("tok", T, "ca000000-0000-4000-8000-000000000001", { scope: "all", date: "2026-10-20" });
    await putAnnouncementAudience("tok", T, "ca000000-0000-4000-8000-000000000001", { scope: "programme", programmeId: F.PROGRAMME, date: "2026-10-20" });
    await putAnnouncementAudience("tok", T, "ca000000-0000-4000-8000-000000000001", { scope: "group", groupId: F.GROUP, date: "2026-10-20" });
    expect(body(0)).toEqual({ scope: "all", date: "2026-10-20" });
    expect(body(1)).toEqual({ scope: "programme", date: "2026-10-20", programme_id: F.PROGRAMME });
    expect(body(2)).toEqual({ scope: "group", date: "2026-10-20", group_id: F.GROUP });
  });
  it("refuses a bad id before any request leaves", async () => {
    await expect(getStudentFees("tok", "x", F.STUDENT)).rejects.toThrow(ApiContractError);
    await expect(getStudentFees("tok", T, "x")).rejects.toThrow(ApiContractError);
    await expect(listStudents("tok", T, { programmeId: "x" })).rejects.toThrow(ApiContractError);
    await expect(getFeeReceipt("tok", T, "x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
