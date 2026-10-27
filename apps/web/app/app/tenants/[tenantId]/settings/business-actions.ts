"use server";

import { revalidatePath } from "next/cache";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { PROFILE_LANGUAGES, saveProfile } from "@/lib/api/profile";
import { requireUser } from "@/lib/auth/session";

export type BusinessState = { ok: true } | { ok: false; error: "invalid" | "role" | "failed" | "session" } | undefined;

/**
 * Settings > Business: the Owner or an Admin changes the business name, the city or area and the languages, at any time (the name was fixed once it was set). The name is needed; the city may stay as it is; at least one language.
 * What is left out is kept by the API. The workspace's pages are read again so the new name shows in the menu and on every page at once.
 */
export async function saveBusinessAction(tenantId: string, _prev: BusinessState, formData: FormData): Promise<BusinessState> {
  const name = String(formData.get("name") ?? "").trim();
  const town = String(formData.get("town") ?? "").trim();
  const languages = formData.getAll("languages").map(String).filter((l) => (PROFILE_LANGUAGES as readonly string[]).includes(l));
  if (name.length < 1 || name.length > 120 || (town !== "" && (town.length < 2 || town.length > 80)) || languages.length < 1) return { ok: false, error: "invalid" };
  try {
    const user = await requireUser();
    if (!isCanonicalUuid(tenantId)) return { ok: false, error: "role" };
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "role" };
    await saveProfile(user.accessToken, tenantId, { name, ...(town !== "" ? { town } : {}), languages: [...new Set(languages)] });
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    if (error instanceof ApiRequestError && error.status === 403) return { ok: false, error: "role" };
    return { ok: false, error: "failed" };
  }
}
