"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { saveFinderSettings } from "@/lib/api/lead-finder";
import { requireUser } from "@/lib/auth/session";
import { RANGES, SETTINGS_FIELDS, type FinderSettings, type SettingsField } from "@/lib/lead-finder/types";

/**
 * Settings -> Lead Finder (job lead-finder part D, contract section 6): save what changed of the fit bar, the calls a day, the calling hours, the searches a day and the results per search. The Owner and an Admin (checked here, and by the
 * API). Every value is a whole number in its range, checked again here (the browser's check is a convenience); the API refuses calling hours that do not start before they end.
 */
export async function saveFinderSettingsAction(tenantId: string, changes: Partial<Record<SettingsField, number>>): Promise<Reply<FinderSettings>> {
  const user = await requireUser();
  const t = appT(await getLang());
  const keys = changes && typeof changes === "object" ? Object.keys(changes) : [];
  const valid = keys.length > 0 && keys.every((k) => (SETTINGS_FIELDS as readonly string[]).includes(k)) && keys.every((k) => {
    const v = changes[k as SettingsField];
    const [min, max] = RANGES[k as SettingsField];
    return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  });
  if (!isCanonicalUuid(tenantId) || !valid) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, kind: "forbidden", error: t("apierr.forbidden") };
    const data = await saveFinderSettings(user.accessToken, tenantId, changes);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    const f = failureOf(error, t);
    return f.code === "invalid_hours" ? { ...f, error: t("lf.set.err.hours") } : f;
  }
}
