"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { CompanyChoice } from "@/components/v2/app/sites/CompanyPicker";
import type { SiteInput, SiteResult } from "@/components/v2/app/sites/sites-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { searchCompanies } from "@/lib/api/companies";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createContact } from "@/lib/api/customers";
import { putSite } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";

async function context() {
  const user = await requireUser();
  return { user, t: appT(await getLang()) };
}

const num = (text: string, min: number, max: number, integer: boolean): number | null | "bad" => {
  const s = text.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)) ? n : "bad";
};
const orNull = (s: string, max: number): string | null | "bad" => {
  const v = s.trim();
  return v === "" ? null : v.length <= max ? v : "bad";
};

/** Find a customer by name for the picker: only the name and the city come back. */
export async function searchCompaniesAction(tenantId: string, query: string): Promise<CompanyChoice[]> {
  const { user } = await context();
  if (!isCanonicalUuid(tenantId) || typeof query !== "string") return [];
  try {
    return await searchCompanies(user.accessToken, tenantId, query);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return [];
  }
}

/** Keep a site (Owner, Admin, Sales). The site's id is the page's, so a second press is a retry. A new site contact is made first, as a contact of THIS customer, and then named on the site. Our sentences only. */
export async function saveSiteAction(tenantId: string, existingContactId: string | null, input: SiteInput): Promise<SiteResult> {
  const { user, t } = await context();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const lat = num(String(input?.lat ?? ""), -90, 90, false);
  const lng = num(String(input?.lng ?? ""), -180, 180, false);
  const distance = num(String(input?.distanceKm ?? ""), 0, 5000, true);
  const lane = num(String(input?.laneWidthFt ?? ""), 0, 1000, false);
  const address = orNull(String(input?.addressLine ?? ""), 400);
  const city = orNull(String(input?.city ?? ""), 120);
  const pin = orNull(String(input?.pin ?? ""), 12);
  const notes = orNull(String(input?.accessNotes ?? ""), 1000);
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(input?.siteId) && isCanonicalUuid(input?.companyId) && name.length >= 1 && name.length <= 200 &&
    [lat, lng, distance, lane, address, city, pin, notes].every((v) => v !== "bad") && (lat === null) === (lng === null) &&
    (pin === null || /^\d{6}$/.test(pin as string)) && ["keep", "new", "none"].includes(input?.contact) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("site.err.invalid") };
  try {
    let contactId: string | null = input.contact === "keep" ? existingContactId : null;
    if (input.contact === "new") {
      const fullName = input.contactName.trim();
      const phone = input.contactPhone.trim();
      if (fullName === "" || fullName.length > 200 || phone === "" || phone.length > 30) return { ok: false, error: t("site.err.contact") };
      contactId = await createContact(user.accessToken, tenantId, { id: crypto.randomUUID(), companyId: input.companyId, fullName, phone, email: null });
    }
    const { site } = await putSite(user.accessToken, tenantId, input.siteId, {
      company_id: input.companyId,
      name,
      address_line: address as string | null,
      city: city as string | null,
      pin: pin as string | null,
      map_lat: lat as number | null,
      map_lng: lng as number | null,
      distance_km: distance as number | null,
      lane_width_ft: lane as number | null,
      night_delivery: input.nightDelivery === true,
      unloading_help: input.unloadingHelp === true,
      access_notes: notes as string | null,
      site_contact_id: contactId,
      active: input.active,
    });
    revalidatePath(`/app/tenants/${tenantId}/sites`);
    return { ok: true, site };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "mfa_required") return { ok: false, error: t("today.err.mfa"), mfa: true };
      if (error.status === 403) return { ok: false, error: t("today.err.role") };
      if (error.status === 422 || error.status === 409) return { ok: false, error: t("site.err.refused") };
      if (error.status === 503) return { ok: false, error: t("site.err.unavailable") };
    }
    return { ok: false, error: t("today.err.generic") };
  }
}
