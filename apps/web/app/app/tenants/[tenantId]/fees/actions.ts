"use server";

import { revalidatePath } from "next/cache";

import type { FeePlanFormInput } from "@/components/v2/app/education/FeePlanForm";
import { isAcademicYear } from "@/components/v2/app/education/fee-plan-logic";
import type { EntryFormInput } from "@/components/v2/app/ledger/EntrySheet";
import { isCanonicalUuid } from "@/lib/api/crm";
import { ADJUSTMENT_REASONS, CONCESSION_REASONS, HEADS, LATE_KINDS, METHODS, assignFeePlan, postLateFees, putFeeAdjustment, putFeeConcession, putFeePayment, putFeePlan, voidFeeAssignment } from "@/lib/api/education";
import { rupeesToPaise } from "@/lib/money";

import { context, failed, validDay, type Failed } from "../education-kit-actions";

const refreshFees = (tenantId: string, studentId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/fees`);
  if (studentId) revalidatePath(`/app/tenants/${tenantId}/fees/students/${studentId}`);
};
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

/** Make or change a fee plan (Owner, Admin). Checked again here: the browser's form is not trusted. The id is the page's, so a second press is a retry. A plan a student holds cannot change (the API says so). */
export async function saveFeePlanAction(tenantId: string, planId: string, input: FeePlanFormInput): Promise<{ ok: true; planId: string } | Failed> {
  const { user, t } = await context();
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const keys = new Set(lines.map((l) => `${l?.head}:${l?.instalment_no}`));
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const late = input?.lateKind;
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(planId) && isCanonicalUuid(input?.programmeId) && (input.groupId === "" || isCanonicalUuid(input.groupId)) && name.length >= 1 && name.length <= 80 && isAcademicYear(String(input.academicYear)) &&
    lines.length >= 1 && lines.length <= 100 && keys.size === lines.length &&
    lines.every((l) => oneOf(HEADS, l?.head) && Number.isInteger(l.instalment_no) && l.instalment_no >= 1 && l.instalment_no <= 60 && validDay(l.due_date) && Number.isInteger(l.amount_paise) && l.amount_paise >= 1 && l.amount_paise <= 100_000_000) &&
    oneOf(LATE_KINDS, late) && (late === "none" ? input.latePaise === null && input.lateCapPaise === null : Number.isInteger(input.latePaise) && (input.latePaise as number) >= 1 && (input.latePaise as number) <= 100_000_000) &&
    Number.isInteger(input.lateGraceDays) && input.lateGraceDays >= 0 && input.lateGraceDays <= 60 && (input.lateCapPaise === null || (late === "per_day" && Number.isInteger(input.lateCapPaise) && input.lateCapPaise >= 1 && input.lateCapPaise <= 1_000_000_000)) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    const plan = await putFeePlan(user.accessToken, tenantId, planId, {
      name, programmeId: input.programmeId, groupId: input.groupId === "" ? null : input.groupId, academicYear: input.academicYear, lateKind: input.lateKind, latePaise: input.latePaise, lateGraceDays: input.lateGraceDays, lateCapPaise: input.lateCapPaise, active: input.active, lines,
    });
    revalidatePath(`/app/tenants/${tenantId}/fees/plans`);
    return { ok: true, planId: plan.id };
  } catch (error) {
    return failed(error, t);
  }
}

/** Give a student a fee plan (Owner, Admin): each instalment becomes a charge on the student's own account. The assignment id is the page's, so a retry writes nothing twice. */
export async function assignPlanAction(tenantId: string, studentId: string, assignmentId: string, planId: string): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (![tenantId, studentId, assignmentId, planId].every(isCanonicalUuid)) return { ok: false, error: t("edu.err.invalid") };
  try {
    await assignFeePlan(user.accessToken, tenantId, assignmentId, studentId, planId, null);
    refreshFees(tenantId, studentId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Take a plan off a student by mistake (Owner, Admin): the charges are voided, the account is worked out again without them. */
export async function voidAssignmentAction(tenantId: string, studentId: string, assignmentId: string): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (![tenantId, studentId, assignmentId].every(isCanonicalUuid)) return { ok: false, error: t("edu.err.invalid") };
  try {
    await voidFeeAssignment(user.accessToken, tenantId, assignmentId);
    refreshFees(tenantId, studentId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/**
 * Write down money on ONE student's account: a payment (Owner, Admin, Sales), or a concession or an adjustment (Owner, Admin, with the second factor; the API decides). The student is bound by the page, never taken from the form.
 * The amount is typed rupees, turned into paise here; a concession by percent is a whole number 1 to 100. The id is the form's, so a second press is a retry. A charge cannot be written here: charges come from a plan.
 */
export async function recordFeeEntryAction(tenantId: string, studentId: string, input: EntryFormInput): Promise<{ ok: true; receiptNo: string | null; entryId: string; replayed: boolean } | Failed> {
  const { user, t } = await context();
  const percent = input?.kind === "concession" && input.mode === "percent";
  const paise = typeof input?.amount === "string" ? rupeesToPaise(input.amount) : null;
  const pct = percent && /^\d{1,3}$/.test(String(input.amount).trim()) ? Number(String(input.amount).trim()) : null;
  const base = isCanonicalUuid(tenantId) && isCanonicalUuid(studentId) && isCanonicalUuid(input?.entryId) && validDay(input?.entryDate);
  const okAmount = percent ? pct !== null && pct >= 1 && pct <= 100 : paise !== null && paise >= 100 && paise <= 10_000_000_000;
  const okKind =
    (input?.kind === "payment" && oneOf(METHODS, input.method)) ||
    (input?.kind === "concession" && oneOf(CONCESSION_REASONS, input.reasonCode)) ||
    (input?.kind === "adjustment" && oneOf(ADJUSTMENT_REASONS, input.reasonCode) && (input.direction === "credit" || (input.direction === "debit" && validDay(input.dueDate) && input.dueDate >= input.entryDate)));
  if (!base || !okAmount || !okKind) return { ok: false, error: t("due.err.invalid") };
  try {
    let receiptNo: string | null = null;
    let replayed = false;
    if (input.kind === "payment") {
      const out = await putFeePayment(user.accessToken, tenantId, studentId, input.entryId, { receivedOn: input.entryDate, amountPaise: paise as number, method: input.method as never, againstEntryId: null });
      receiptNo = out.receipt_no;
      replayed = out.replayed;
    } else if (input.kind === "concession") {
      const out = await putFeeConcession(user.accessToken, tenantId, studentId, input.entryId, { mode: percent ? "percent" : "amount", value: percent ? (pct as number) : (paise as number), reasonCode: input.reasonCode as never, reference: null });
      replayed = out.replayed;
    } else {
      const out = await putFeeAdjustment(user.accessToken, tenantId, studentId, input.entryId, { direction: input.direction, amountPaise: paise as number, reasonCode: input.reasonCode as never, dueDate: input.direction === "debit" ? input.dueDate : null, reference: null });
      replayed = out.replayed;
    }
    refreshFees(tenantId, studentId);
    return { ok: true, receiptNo, entryId: input.entryId, replayed };
  } catch (error) {
    return failed(error, t);
  }
}

/** Post the late fees the plans' rules give today (Owner, Admin, with the second factor). Posting twice adds nothing twice. */
export async function postLateFeesAction(tenantId: string): Promise<{ ok: true; posted: number; totalPaise: number } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("edu.err.invalid") };
  try {
    const out = await postLateFees(user.accessToken, tenantId);
    refreshFees(tenantId);
    return { ok: true, posted: out.posted, totalPaise: out.total_paise };
  } catch (error) {
    return failed(error, t);
  }
}
