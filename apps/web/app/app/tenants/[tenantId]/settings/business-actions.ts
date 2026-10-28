"use server";

import { revalidatePath } from "next/cache";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { PROFILE_LANGUAGES, saveProfile } from "@/lib/api/profile";
import { getWorkspaceProfile, patchWorkspaceProfile, removeLogo, uploadLogo, type WorkspacePatch } from "@/lib/api/workspace";
import { requireUser } from "@/lib/auth/session";
import { pictureProblem } from "@/lib/picture";

export type BusinessError = "invalid" | "role" | "failed" | "session" | "type_pack_data_present" | "type_lead_data_present" | "type_unknown_type";
export type BusinessState = { ok: true } | { ok: false; error: BusinessError } | undefined;
export type LogoError = "invalid" | "toobig" | "kind" | "role" | "failed" | "session";
export type LogoState = { ok: true } | { ok: false; error: LogoError } | undefined;

const REFUSALS: Readonly<Record<string, BusinessError>> = { pack_data_present: "type_pack_data_present", lead_data_present: "type_lead_data_present", unknown_type: "type_unknown_type" };
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

/**
 * Settings > Business: the Owner changes the business name, the kind of business (with "Other" and what it is), the city or area, the phone and the languages, at any time; an Admin changes the name, the city and the languages (the older
 * `PUT /profile`). The name is needed; the city and phone may be emptied (that clears them); at least one language. A change of kind the business data does not allow comes back as the API's own reason. The workspace's pages are read again so the new
 * name shows in the menu and on every page at once.
 */
export async function saveBusinessAction(tenantId: string, _prev: unknown, formData: FormData): Promise<BusinessState> {
  const name = String(formData.get("name") ?? "").trim();
  const town = String(formData.get("town") ?? "").trim();
  const phone = formData.has("phone") ? String(formData.get("phone") ?? "").trim() : null;
  const type = String(formData.get("type") ?? "").trim();
  const label = String(formData.get("other_label") ?? "").trim();
  const languages = [...new Set(formData.getAll("languages").map(String).filter((l) => (PROFILE_LANGUAGES as readonly string[]).includes(l)))];
  if (name.length < 1 || name.length > 120 || (town !== "" && (town.length < 2 || town.length > 80)) || languages.length < 1) return { ok: false, error: "invalid" };
  if (phone !== null && phone !== "" && !PHONE.test(phone)) return { ok: false, error: "invalid" };
  try {
    const user = await requireUser();
    if (!isCanonicalUuid(tenantId)) return { ok: false, error: "role" };
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role === "owner") {
      const now = await getWorkspaceProfile(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null));
      const patch: WorkspacePatch = { name, languages, city: town === "" ? null : town };
      if (phone !== null) patch.phone = phone === "" ? null : phone;
      // the kind is sent only when it changed (or the words of "Other" did), so a refusal about the kind never blocks a rename
      if (type !== "" && (now === null || type !== now.type || (type === "other" && label !== "" && label !== (now.typeLabel ?? "")))) {
        if (type === "other" && (label.length < 2 || label.length > 60)) return { ok: false, error: "invalid" };
        patch.type = type;
        if (type === "other") patch.type_label = label;
      }
      await patchWorkspaceProfile(user.accessToken, tenantId, patch);
    } else if (tenant.role === "admin") {
      await saveProfile(user.accessToken, tenantId, { name, ...(town !== "" ? { town } : {}), languages });
    } else return { ok: false, error: "role" };
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "role" };
      if (error.status === 409 && error.code === "type_change_refused") return { ok: false, error: REFUSALS[error.reason ?? ""] ?? "failed" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "failed" };
  }
}

/**
 * The business logo: the Owner or an Admin sets it (a JPG, PNG or WebP of at most 5 MB, sent as the body) or removes it (`remove=1`). The size and the type are checked here and again by the API from the bytes.
 */
export async function logoAction(tenantId: string, _prev: unknown, formData: FormData): Promise<LogoState> {
  const remove = formData.get("remove") === "1";
  const file = formData.get("logo");
  const problem = remove ? null : pictureProblem(file);
  if (problem) return { ok: false, error: problem };
  try {
    const user = await requireUser();
    if (!isCanonicalUuid(tenantId)) return { ok: false, error: "role" };
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "role" };
    if (remove) await removeLogo(user.accessToken, tenantId);
    else await uploadLogo(user.accessToken, tenantId, await (file as File).arrayBuffer(), (file as File).type);
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "role" };
      if (error.status === 413) return { ok: false, error: "toobig" };
      if (error.status === 415) return { ok: false, error: "kind" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "failed" };
  }
}
