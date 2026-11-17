"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiContractError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { recordMarketingYes, tidyNote, withdrawMarketing } from "@/lib/api/marketing-consent";
import { requireUser } from "@/lib/auth/session";
import { offerScreens } from "@/lib/screens/flag";

/**
 * Who said yes to offers: record a yes (with the note of how it was given) or a no (campaigns S3). Owner, Admin and Sales; the API decides again. A customer who said STOP cannot be recorded as a yes: the answer is `stopped`.
 * Nothing here sends a message.
 */
export type ConsentResult = { ok: true } | { ok: false; error: "stopped" | "invalid" | "forbidden" | "down" };
const STAFF = ["owner", "admin", "sales"];

async function token(tenantId: string): Promise<string | null> {
  const user = await requireUser();
  if (offerScreens() === "off" || !isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return STAFF.includes(tenant.role) ? user.accessToken : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

function refusal(error: unknown): ConsentResult {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiContractError) return { ok: false, error: "invalid" };
  if (error instanceof ApiRequestError) {
    if (/suppress|stopped|do_not_contact/i.test(error.code ?? "")) return { ok: false, error: "stopped" };
    if (error.status === 403) return { ok: false, error: "forbidden" };
    if (error.status === 400 || error.status === 409 || error.status === 422) return { ok: false, error: "invalid" };
  }
  return { ok: false, error: "down" };
}

export async function recordYesAction(tenantId: string, contactId: string, note: string): Promise<ConsentResult> {
  const t = await token(tenantId);
  if (!t || !isCanonicalUuid(contactId)) return { ok: false, error: "forbidden" };
  if (tidyNote(note) === null) return { ok: false, error: "invalid" };
  try {
    await recordMarketingYes(t, tenantId, contactId, note);
    revalidatePath(`/app/tenants/${tenantId}/marketing-consent`);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

export async function withdrawAction(tenantId: string, contactId: string): Promise<ConsentResult> {
  const t = await token(tenantId);
  if (!t || !isCanonicalUuid(contactId)) return { ok: false, error: "forbidden" };
  try {
    await withdrawMarketing(t, tenantId, contactId);
    revalidatePath(`/app/tenants/${tenantId}/marketing-consent`);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}
