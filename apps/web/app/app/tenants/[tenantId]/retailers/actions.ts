"use server";

import { revalidatePath } from "next/cache";

import type { ConfirmResult } from "@/components/v2/app/retailers/RetailersSearch";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { confirmPlace } from "@/lib/api/retailers";
import { requireUser } from "@/lib/auth/session";

/**
 * Keep a shop found on the map as a lead (job CC, screen 3). The name and city are what the person TYPED; the card's id (stable, made from Google's place ID) is the only thing kept from the map. The same shop saved twice is
 * the same lead. Owner, Admin and Sales (the API checks the role).
 */
export async function confirmPlaceAction(tenantId: string, placeId: string, name: string, city: string, region: string): Promise<ConfirmResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId) || typeof name !== "string" || name.trim().length < 1 || name.length > 200 || String(city).length > 100 || String(region).length > 100) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const r = await confirmPlace(user.accessToken, tenantId, { placeId, companyName: name, city, region });
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, data: { lead_id: r.lead_id, created: r.created } };
  } catch (error) {
    return failureOf(error, t);
  }
}
