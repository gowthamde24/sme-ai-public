"use server";

import { revalidatePath } from "next/cache";

import type { StudentFormInput } from "@/components/v2/app/education/StudentForm";
import { isCanonicalUuid } from "@/lib/api/crm";
import { eraseStudent, putStudent, setStudentStatus } from "@/lib/api/education";

import { context, failed, validDay, type Failed } from "../education-kit-actions";

const LABEL = /^[^0-9@]{1,30}$/;
const ADMISSION_NO = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/;
const refresh = (tenantId: string, studentId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/students`);
  if (studentId) revalidatePath(`/app/tenants/${tenantId}/students/${studentId}`);
  revalidatePath(`/app/tenants/${tenantId}/programmes`);
};

/**
 * Add or change a student (Owner, Admin): the MINIMUM only. A child needs a first name or initials with no digit and no `@`; an adult student has no label. The checks run here too, before the request: the browser's form is not trusted.
 * The id is the page's, so a second press is a retry. Nothing here can carry a note, a date of birth, a number or an address: the input type has no such field.
 */
export async function saveStudentAction(tenantId: string, studentId: string, input: StudentFormInput): Promise<{ ok: true; studentId: string } | Failed> {
  const { user, t } = await context();
  const label = typeof input?.childLabel === "string" ? input.childLabel.trim() : "";
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(studentId) && isCanonicalUuid(input?.contactId) && isCanonicalUuid(input?.programmeId) && (input.groupId === "" || isCanonicalUuid(input.groupId)) && typeof input.isAdult === "boolean" &&
    (input.isAdult ? label === "" : LABEL.test(label)) && (input.admissionNo === "" || ADMISSION_NO.test(input.admissionNo)) && (input.joinedOn === "" || validDay(input.joinedOn));
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    const { student } = await putStudent(user.accessToken, tenantId, studentId, {
      contactId: input.contactId, isAdult: input.isAdult, childLabel: input.isAdult ? null : label, programmeId: input.programmeId, groupId: input.groupId === "" ? null : input.groupId,
      admissionNo: input.admissionNo === "" ? null : input.admissionNo, guardianContactId: null, joinedOn: input.joinedOn === "" ? null : input.joinedOn,
    });
    refresh(tenantId, student.id);
    return { ok: true, studentId: student.id };
  } catch (error) {
    return failed(error, t);
  }
}

/** Mark a student as having left on a day (it starts the retention clock) or as back (Owner, Admin). */
export async function studentStatusAction(tenantId: string, studentId: string, status: "active" | "left", leftOn: string | null): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const ok = isCanonicalUuid(tenantId) && isCanonicalUuid(studentId) && (status === "active" ? leftOn === null : status === "left" && validDay(leftOn));
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    await setStudentStatus(user.accessToken, tenantId, studentId, status, leftOn);
    refresh(tenantId, studentId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Erase one child on request (the Owner, with the second factor): the name and number go, the row and the money records stay. */
export async function eraseStudentAction(tenantId: string, studentId: string): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(studentId)) return { ok: false, error: t("edu.err.invalid") };
  try {
    await eraseStudent(user.accessToken, tenantId, studentId);
    refresh(tenantId, studentId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}
