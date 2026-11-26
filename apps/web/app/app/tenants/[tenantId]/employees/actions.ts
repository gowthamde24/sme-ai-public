"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createEmployee, getEmployee, getEmployeeActivity, patchEmployee, previewEmployee, refusalOf, setEmployeePhone, setEmployeeStatus, setEmployeeVoice, type EmployeePreview } from "@/lib/api/employees";
import { requireUser } from "@/lib/auth/session";
import { employeeScreens } from "@/lib/screens/flag";
import { INSTRUCTIONS_MAX, NAME_MAX, NEVER_SAY_LEN, NEVER_SAY_MAX, ROLE_TITLE_MAX, ROLE_TITLE_MIN, isRole, hoursOk, type ActivityCall, type Done, type Employee, type EmployeePatch, type EmployeeStatus } from "@/lib/employees/types";

/**
 * The moves of the AI employees (flag EMPLOYEES; C1's docs/contracts/employees.md). Owner and Admin change them (the API asks for the second factor when the authenticator is on); every input is checked again here (the browser is not trusted)
 * and every answer is a closed word the screen draws in plain language (`emp.err.*`), never the API's own text.
 */
async function who(tenantId: string): Promise<{ token: string; role: string } | null> {
  if (employeeScreens() === "off" || !isCanonicalUuid(tenantId)) return null;
  const user = await requireUser();
  try {
    return { token: user.accessToken, role: (await fetchTenant(user.accessToken, tenantId)).role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const canWrite = (role: string): boolean => role === "owner" || role === "admin";
const no = (error: "forbidden" | "validation_error" | "not_found"): { ok: false; error: typeof error } => ({ ok: false, error });
const wrap = async <T>(run: () => Promise<T>): Promise<Done<T>> => {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return refusalOf(error);
  }
};
const clean = (v: unknown, min: number, max: number): string | null => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);
const refresh = (tenantId: string, id?: string): void => {
  revalidatePath(`/app/tenants/${tenantId}/employees`);
  if (id) revalidatePath(`/app/tenants/${tenantId}/employees/${id}`);
};

/** Step 1 and 2 of the wizard: the role and the name make a draft. The id is minted once per opening of the wizard, so a retry is the same employee. */
export async function createEmployeeAction(tenantId: string, input: { id: unknown; roleCode: unknown; name: unknown }): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  const name = clean(input.name, 1, NAME_MAX);
  if (!name || !isRole(input.roleCode) || typeof input.id !== "string" || !isCanonicalUuid(input.id)) return no("validation_error");
  const out = await wrap(() => createEmployee(me.token, tenantId, { id: input.id as string, roleCode: input.roleCode as string, name }));
  if (out.ok) refresh(tenantId);
  return out;
}

/** A patch of one employee: only the fields that were named, each checked against the contract's own limits. */
export async function patchEmployeeAction(tenantId: string, id: string, patch: EmployeePatch): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  if (!isCanonicalUuid(id) || typeof patch !== "object" || patch === null) return no("validation_error");
  const out: EmployeePatch = {};
  if (patch.name !== undefined) {
    const n = clean(patch.name, 1, NAME_MAX);
    if (!n) return no("validation_error");
    out.name = n;
  }
  if (patch.roleCode !== undefined) {
    if (!isRole(patch.roleCode)) return no("validation_error");
    out.roleCode = patch.roleCode;
  }
  if (patch.roleTitle !== undefined) {
    if (patch.roleTitle !== null) {
      const t = clean(patch.roleTitle, ROLE_TITLE_MIN, ROLE_TITLE_MAX);
      if (!t) return no("validation_error");
      out.roleTitle = t;
    } else out.roleTitle = null;
  }
  if (patch.extraInstructions !== undefined) {
    if (patch.extraInstructions !== null) {
      if (typeof patch.extraInstructions !== "string" || patch.extraInstructions.length > INSTRUCTIONS_MAX) return no("validation_error");
      out.extraInstructions = patch.extraInstructions.trim() === "" ? null : patch.extraInstructions;
    } else out.extraInstructions = null;
  }
  if (patch.responsibilities !== undefined) {
    if (!Array.isArray(patch.responsibilities) || patch.responsibilities.some((r) => typeof r !== "string") || patch.responsibilities.length > 30) return no("validation_error");
    out.responsibilities = patch.responsibilities;
  }
  if (patch.neverSay !== undefined) {
    if (!Array.isArray(patch.neverSay) || patch.neverSay.length > NEVER_SAY_MAX || patch.neverSay.some((w) => typeof w !== "string" || w.trim().length < 1 || w.length > NEVER_SAY_LEN)) return no("validation_error");
    out.neverSay = patch.neverSay.map((w) => w.trim());
  }
  if (patch.hours !== undefined) {
    if (patch.hours !== null && !hoursOk(patch.hours)) return { ok: false, error: "hours_wider" };
    out.hours = patch.hours;
  }
  // the rest is passed as it is: the API checks the closed words and the ranges, and answers `validation_error`
  for (const k of ["languages", "autoSwitchLanguage", "allowEnglishMixing", "style", "speed", "openingLine", "autonomy", "askFirst"] as const) if (patch[k] !== undefined) (out as Record<string, unknown>)[k] = patch[k];
  const done = await wrap(() => patchEmployee(me.token, tenantId, id, out));
  if (done.ok) refresh(tenantId, id);
  return done;
}

export async function setEmployeeStatusAction(tenantId: string, id: string, status: unknown): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  if (!isCanonicalUuid(id) || (status !== "on" && status !== "paused" && status !== "archived")) return no("validation_error");
  const done = await wrap(() => setEmployeeStatus(me.token, tenantId, id, status as Exclude<EmployeeStatus, "draft">));
  if (done.ok) refresh(tenantId, id);
  return done;
}

export async function setEmployeeVoiceAction(tenantId: string, id: string, language: unknown, voiceCode: unknown): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  if (!isCanonicalUuid(id) || typeof language !== "string" || !/^[a-z]{2,3}$/.test(language) || typeof voiceCode !== "string" || voiceCode.length < 1 || voiceCode.length > 100) return no("validation_error");
  const done = await wrap(() => setEmployeeVoice(me.token, tenantId, id, language, voiceCode));
  if (done.ok) refresh(tenantId, id);
  return done;
}

export async function setEmployeePhoneAction(tenantId: string, id: string, phoneNumberId: unknown): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  if (!isCanonicalUuid(id) || (phoneNumberId !== null && (typeof phoneNumberId !== "string" || !isCanonicalUuid(phoneNumberId)))) return no("validation_error");
  const done = await wrap(() => setEmployeePhone(me.token, tenantId, id, phoneNumberId as string | null));
  if (done.ok) refresh(tenantId, id);
  return done;
}

/** "Play sample": the employee's opening line (or a sample sentence) in ITS voice. A voice that cannot speak is `voice_unavailable`: another voice never stands in. */
export async function previewEmployeeAction(tenantId: string, id: string, input: { language: unknown; text?: unknown }): Promise<Done<EmployeePreview>> {
  const me = await who(tenantId);
  if (!me) return no("forbidden");
  if (!isCanonicalUuid(id) || typeof input.language !== "string" || !/^[a-z]{2,3}$/.test(input.language)) return no("validation_error");
  const text = typeof input.text === "string" && input.text.trim() !== "" ? input.text.trim().slice(0, 300) : undefined;
  return wrap(() => previewEmployee(me.token, tenantId, id, { language: input.language as string, ...(text ? { text } : {}) }));
}

export async function loadEmployeeAction(tenantId: string, id: string): Promise<Done<Employee>> {
  const me = await who(tenantId);
  if (!me) return no("forbidden");
  if (!isCanonicalUuid(id)) return no("validation_error");
  return wrap(() => getEmployee(me.token, tenantId, id));
}

export async function loadActivityAction(tenantId: string, id: string, before?: string): Promise<Done<ActivityCall[]>> {
  const me = await who(tenantId);
  if (!me) return no("forbidden");
  if (!isCanonicalUuid(id)) return no("validation_error");
  return wrap(() => getEmployeeActivity(me.token, tenantId, id, { limit: 30, ...(before ? { before } : {}) }));
}
