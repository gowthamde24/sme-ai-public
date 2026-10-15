"use server";

import { revalidatePath } from "next/cache";

import type { AdmissionFormInput } from "@/components/v2/app/education/AdmissionForm";
import type { AdmitFormInput } from "@/components/v2/app/education/AdmissionDetail";
import { isCanonicalUuid } from "@/lib/api/crm";
import { LOST_REASONS, SOURCES, admit, putAdmission, setAdmissionStage } from "@/lib/api/education";

import { context, failed, validDay, type Failed } from "../education-kit-actions";

const LABEL = /^[^0-9@]{1,30}$/;
const ADMISSION_NO = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/;
const PHONE = /^[0-9+ ()-]{3,32}$/;
const refresh = (tenantId: string, admissionId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/admissions`);
  if (admissionId) revalidatePath(`/app/tenants/${tenantId}/admissions/${admissionId}`);
};
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

/** Start an enquiry (Owner, Admin, Sales): an existing contact OR a new guardian's name and number, never both and never a child. The id is the page's, so a second press is a retry. */
export async function saveAdmissionAction(tenantId: string, admissionId: string, input: AdmissionFormInput): Promise<{ ok: true; admissionId: string } | Failed> {
  const { user, t } = await context();
  const name = typeof input?.guardianName === "string" ? input.guardianName.trim() : "";
  const phone = typeof input?.guardianPhone === "string" ? input.guardianPhone.trim() : "";
  const existing = typeof input?.contactId === "string" && input.contactId !== "";
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(admissionId) && oneOf(SOURCES, input?.source) && (input.programmeId === "" || isCanonicalUuid(input.programmeId)) &&
    (existing ? isCanonicalUuid(input.contactId) && name === "" && phone === "" : name.length >= 1 && name.length <= 200 && PHONE.test(phone));
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    const { admission } = await putAdmission(user.accessToken, tenantId, admissionId, {
      source: input.source as never, programmeId: input.programmeId === "" ? null : input.programmeId, contactId: existing ? input.contactId : null, guardianName: existing ? null : name, guardianPhone: existing ? null : phone,
    });
    refresh(tenantId, admission.id);
    return { ok: true, admissionId: admission.id };
  } catch (error) {
    return failed(error, t);
  }
}

/** Move an enquiry forward, lose it (with a reason) or re-open a lost one (Owner, Admin). The API refuses a move back and says so. */
export async function admissionStageAction(tenantId: string, admissionId: string, stage: "enquiry" | "campus_visit" | "application" | "lost", lostReason: string | null): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const ok = isCanonicalUuid(tenantId) && isCanonicalUuid(admissionId) && ["enquiry", "campus_visit", "application", "lost"].includes(stage) && (stage === "lost" ? oneOf(LOST_REASONS, lostReason) : lostReason === null);
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    await setAdmissionStage(user.accessToken, tenantId, admissionId, stage, lostReason as never);
    refresh(tenantId, admissionId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/**
 * Admit (Owner, Admin): the enquiry becomes a student and, with a plan, the plan is assigned, in ONE transaction (the API undoes everything if anything is wrong). Both ids are the screen's, so a retry makes nothing twice.
 * The minimum only: a first name or initials without digits (an adult student has none), the placement, an optional admission number and day.
 */
export async function admitAction(tenantId: string, admissionId: string, input: AdmitFormInput): Promise<{ ok: true; studentId: string } | Failed> {
  const { user, t } = await context();
  const label = typeof input?.childLabel === "string" ? input.childLabel.trim() : "";
  const plan = typeof input?.planId === "string" && input.planId !== "";
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(admissionId) && isCanonicalUuid(input?.studentId) && isCanonicalUuid(input?.programmeId) && (input.groupId === "" || isCanonicalUuid(input.groupId)) && typeof input.isAdult === "boolean" &&
    (input.isAdult ? label === "" : LABEL.test(label)) && (input.admissionNo === "" || ADMISSION_NO.test(input.admissionNo)) && (input.joinedOn === "" || validDay(input.joinedOn)) && (plan ? isCanonicalUuid(input.planId) && isCanonicalUuid(input.assignmentId) : true);
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    const out = await admit(user.accessToken, tenantId, admissionId, {
      studentId: input.studentId, isAdult: input.isAdult, childLabel: input.isAdult ? null : label, programmeId: input.programmeId, groupId: input.groupId === "" ? null : input.groupId, admissionNo: input.admissionNo === "" ? null : input.admissionNo,
      planId: plan ? input.planId : null, assignmentId: plan ? input.assignmentId : null, joinedOn: input.joinedOn === "" ? null : input.joinedOn,
    });
    refresh(tenantId, admissionId);
    revalidatePath(`/app/tenants/${tenantId}/students`);
    return { ok: true, studentId: out.student_id ?? input.studentId };
  } catch (error) {
    return failed(error, t);
  }
}
