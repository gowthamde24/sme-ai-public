"use server";

import { revalidatePath } from "next/cache";

import type { GroupInput, ProfileInput, ProgrammeInput } from "@/components/v2/app/education/ProgrammesView";
import { GROUP_KINDS, INSTITUTION_TYPES, PARENT_LANGUAGES, PROGRAMME_KINDS, putGroup, putInstitutionProfile, putProgramme } from "@/lib/api/education";
import { isCanonicalUuid } from "@/lib/api/crm";

import { context, failed, type Failed } from "../education-kit-actions";

const refresh = (tenantId: string) => {
  revalidatePath(`/app/tenants/${tenantId}/programmes`);
  revalidatePath(`/app/tenants/${tenantId}`);
};
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

/** Save the institution (Owner, Admin). The retention months ride along only as the screen shows them; the API lets the Owner alone, with the second factor, change them. */
export async function saveProfileAction(tenantId: string, input: ProfileInput): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const terms = Array.isArray(input?.terms) ? input.terms : [];
  const langs = Array.isArray(input?.parentLanguages) ? input.parentLanguages : [];
  const ok =
    isCanonicalUuid(tenantId) && oneOf(INSTITUTION_TYPES, input?.institutionType) && Number.isInteger(input.yearStartMonth) && input.yearStartMonth >= 1 && input.yearStartMonth <= 12 && terms.length <= 6 &&
    terms.every((x) => typeof x?.label === "string" && x.label.trim().length >= 1 && x.label.length <= 40 && Number.isInteger(x.start_month) && x.start_month >= 1 && x.start_month <= 12 && Number.isInteger(x.end_month) && x.end_month >= 1 && x.end_month <= 12) &&
    langs.length >= 1 && langs.length <= 5 && new Set(langs).size === langs.length && langs.every((l) => oneOf(PARENT_LANGUAGES, l)) &&
    (input.retentionMonths === null || (Number.isInteger(input.retentionMonths) && input.retentionMonths >= 1 && input.retentionMonths <= 240));
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    await putInstitutionProfile(user.accessToken, tenantId, { institutionType: input.institutionType as never, yearStartMonth: input.yearStartMonth, terms, parentLanguages: langs as never, retentionMonths: input.retentionMonths });
    refresh(tenantId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Make or change a programme (Owner, Admin). The id is the screen's, so a second press is a retry. A programme is never deleted: it is made inactive. */
export async function saveProgrammeAction(tenantId: string, programmeId: string, input: ProgrammeInput): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const ok = isCanonicalUuid(tenantId) && isCanonicalUuid(programmeId) && name.length >= 1 && name.length <= 80 && oneOf(PROGRAMME_KINDS, input.kind) && oneOf(GROUP_KINDS, input.groupKind) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    await putProgramme(user.accessToken, tenantId, programmeId, { name, kind: input.kind, groupKind: input.groupKind, active: input.active });
    refresh(tenantId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Make or change a section, year, semester or batch of a programme (Owner, Admin). Never deleted: made inactive. */
export async function saveGroupAction(tenantId: string, programmeId: string, groupId: string, input: GroupInput): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const label = typeof input?.label === "string" ? input.label.trim() : "";
  const ok = isCanonicalUuid(tenantId) && isCanonicalUuid(programmeId) && isCanonicalUuid(groupId) && label.length >= 1 && label.length <= 80 && (input.timing === null || (typeof input.timing === "string" && input.timing.length <= 80)) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("edu.err.invalid") };
  try {
    await putGroup(user.accessToken, tenantId, programmeId, groupId, { label, timing: input.timing, active: input.active });
    refresh(tenantId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}
