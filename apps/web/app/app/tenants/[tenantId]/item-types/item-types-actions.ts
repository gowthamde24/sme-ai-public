"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchItemTypes, saveItemType, type SaveItemTypeInput } from "@/lib/api/item-types";
import { requireUser } from "@/lib/auth/session";

import { NOT_AVAILABLE, TEXT, itemTypeFromForm, saveRefusal, type ItemTypeValues } from "./item-types-logic";

/** What a form shows after a press: `ok` with ONE sentence of our wording, or a refusal sentence of our wording (`reason: "mfa"` points at the second-factor page). Never text from the API. */
export type ItemTypeState = { ok?: boolean; error?: string; reason?: "mfa"; message?: string } | undefined;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function valuesOf(formData: FormData): ItemTypeValues {
  return {
    name: text(formData, "name"),
    code: text(formData, "code"),
    position: text(formData, "position"),
    active: formData.get("active") === "on",
    lowest: text(formData, "lowest"),
    highest: text(formData, "highest"),
  };
}

async function send(accessToken: string, tenantId: string, input: SaveItemTypeInput, kind: "add" | "edit"): Promise<ItemTypeState> {
  try {
    const done = await saveItemType(accessToken, tenantId, input);
    revalidatePath(`/app/tenants/${tenantId}/item-types`);
    if (kind === "add" && !done.created) return { ok: true, message: "That code had just been added by someone else, so that item type was changed instead. Check the list below." };
    return { ok: true, message: kind === "add" ? "Added." : "Saved." };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) return { ok: false, ...saveRefusal(error.status, error.code) };
    return { ok: false, ...saveRefusal(500, "") };
  }
}

/** The codes that already exist, read just before a save: the API call REPLACES a record, so a new type must not silently take the place of an existing one. */
async function existingCodes(accessToken: string, tenantId: string): Promise<Set<string> | ItemTypeState> {
  try {
    return new Set((await fetchItemTypes(accessToken, tenantId)).map((t) => t.code));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) return { ok: false, ...saveRefusal(error.status, error.code) };
    return { ok: false, ...saveRefusal(500, "") };
  }
}

/**
 * Add an item type (an owner or an admin, with the authenticator app: the API asks for it and the database again). The server reads ONLY the typed fields; each price is read
 * into integer paise from the text, never with floating point. The code is typed once; if it already exists the save is REFUSED here (the API call would replace that record).
 */
export async function addItemTypeAction(tenantId: string, _prev: ItemTypeState, formData: FormData): Promise<ItemTypeState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: NOT_AVAILABLE };
  const values = valuesOf(formData);
  const checked = itemTypeFromForm({ ...values, active: true }, values.code.trim());
  if (!checked.ok) return { ok: false, error: checked.error };
  const codes = await existingCodes(user.accessToken, tenantId);
  if (!(codes instanceof Set)) return codes;
  if (codes.has(checked.input.code)) return { ok: false, error: TEXT.exists };
  return send(user.accessToken, tenantId, checked.input, "add");
}

/** Change an existing item type's name, order, switch and prices (the code never changes). The code comes from the page's own binding, not from the form. */
export async function saveItemTypeAction(tenantId: string, code: string, _prev: ItemTypeState, formData: FormData): Promise<ItemTypeState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: NOT_AVAILABLE };
  const checked = itemTypeFromForm(valuesOf(formData), code);
  if (!checked.ok) return { ok: false, error: checked.error };
  const codes = await existingCodes(user.accessToken, tenantId);
  if (!(codes instanceof Set)) return codes;
  if (!codes.has(code)) return { ok: false, error: TEXT.unknown };
  return send(user.accessToken, tenantId, checked.input, "edit");
}
