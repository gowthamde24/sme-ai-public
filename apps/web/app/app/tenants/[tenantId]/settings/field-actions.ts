"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { MAX_FIELDS_PER_ENTITY, type FieldNotice } from "@/components/v2/app/fields/FieldsSection";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createCustomField, listCustomFields, setCustomFieldActive, updateCustomField, type NewField } from "@/lib/api/custom-fields";
import { getLang } from "@/i18n/get-lang";
import { requireUser } from "@/lib/auth/session";
import { codeOf, parseChoices, parseMoreChoices } from "@/lib/packs/field-codes";
import type { FieldEntity, FieldKind } from "@/lib/packs/types";

const KINDS: readonly FieldKind[] = ["text", "number", "date", "choice", "yes_no"];
const ENTITIES: readonly FieldEntity[] = ["contact", "catalogue_item"];

function done(tenantId: string, notice: Exclude<FieldNotice, null>): never {
  revalidatePath(`/app/tenants/${tenantId}/settings`);
  redirect(`/app/tenants/${tenantId}/settings?section=fields&fieldnote=${notice}`);
}

async function managerOf(tenantId: string) {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  const tenant = await fetchTenant(user.accessToken, tenantId).catch((e) => {
    if (e instanceof ApiAuthError) throw e;
    return null;
  });
  return tenant && (tenant.role === "owner" || tenant.role === "admin") ? user : null;
}

function noticeOf(error: unknown): Exclude<FieldNotice, null> {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || error.status === 501 || error.status === 503) return "unavailable";
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "module_off") return "unavailable";
    if (error.status === 403) return "role";
    if (error.code === "custom_field_limit") return "limit";
    if (error.status === 400 || error.status === 409 || error.status === 422) return "invalid";
  }
  return "failed";
}

/** Add a field of the owner's own (Owner or Admin; the API wants the second factor and checks the rest). At most 20 for each kind of record. */
export async function addFieldAction(tenantId: string, formData: FormData): Promise<void> {
  const user = await managerOf(tenantId).catch(() => redirect("/login"));
  if (!user) return done(tenantId, "role");
  const entity = String(formData.get("entity") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!(ENTITIES as readonly string[]).includes(entity) || !(KINDS as readonly string[]).includes(kind) || label.length < 1 || label.length > 60) return done(tenantId, "invalid");
  const needsChoices = kind === "choice";
  const choices = needsChoices ? parseChoices(String(formData.get("choices") ?? "")) : null;
  if (needsChoices && !choices) return done(tenantId, "invalid");
  let existing;
  try {
    existing = await listCustomFields(user.accessToken, tenantId, entity as FieldEntity);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return done(tenantId, noticeOf(error));
  }
  if (existing.filter((f) => f.active).length >= MAX_FIELDS_PER_ENTITY) return done(tenantId, "limit");
  const input: NewField = { entity: entity as FieldEntity, code: codeOf(label), kind: kind as FieldKind, label, required: formData.get("required") === "on", ...(choices ? { choices } : {}) };
  if (existing.some((f) => f.code === input.code)) input.code = `${input.code.slice(0, 33)}_${existing.length}`;
  try {
    await createCustomField(user.accessToken, tenantId, input);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return done(tenantId, noticeOf(error));
  }
  return done(tenantId, "added");
}

/** Hide a field, or show it again. Nothing is deleted: the values already kept stay. */
export async function setFieldActiveAction(tenantId: string, formData: FormData): Promise<void> {
  const user = await managerOf(tenantId).catch(() => redirect("/login"));
  if (!user) return done(tenantId, "role");
  const id = String(formData.get("field_id") ?? "");
  if (id.length < 1 || id.length > 64) return done(tenantId, "invalid");
  try {
    await setCustomFieldActive(user.accessToken, tenantId, id, formData.get("active") === "yes");
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return done(tenantId, noticeOf(error));
  }
  return done(tenantId, "updated");
}

/**
 * Change a field: its words (in the language the person is reading; the other languages stay as they are), whether a record needs it, and more choices for a choice field (choices only grow; a field's code, kind and record
 * type never change). Owner or Admin (the API wants the second factor).
 */
export async function updateFieldAction(tenantId: string, formData: FormData): Promise<void> {
  const user = await managerOf(tenantId).catch(() => redirect("/login"));
  if (!user) return done(tenantId, "role");
  const id = String(formData.get("field_id") ?? "");
  const text = String(formData.get("label") ?? "").trim();
  if (id.length < 1 || id.length > 64 || text.length < 1 || text.length > 60) return done(tenantId, "invalid");
  let current;
  try {
    current = (await listCustomFields(user.accessToken, tenantId)).find((f) => f.id === id);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return done(tenantId, noticeOf(error));
  }
  if (!current) return done(tenantId, "invalid");
  const more = current.kind === "choice" || current.kind === "multi_choice" ? parseMoreChoices(String(formData.get("choices") ?? ""), (current.choices ?? []).map((c) => c.code)) : [];
  if (more === null) return done(tenantId, "invalid");
  const lang = await getLang();
  try {
    await updateCustomField(user.accessToken, tenantId, id, { label: { ...current.label, [lang]: text }, required: formData.get("required") === "on", addChoices: more });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return done(tenantId, noticeOf(error));
  }
  return done(tenantId, "updated");
}
