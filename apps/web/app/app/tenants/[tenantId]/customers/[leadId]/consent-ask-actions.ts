"use server";

import { redirect } from "next/navigation";

import { ApiAuthError, ApiContractError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { getConsentAsk, sendConsentAsk, type ConsentAskPreview } from "@/lib/api/consent-ask";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { offerScreens } from "@/lib/screens/flag";

export type AskError = "forbidden" | "template" | "nothing" | "invalid" | "down";
export type PreviewResult = { ok: true; preview: ConsentAskPreview } | { ok: false; error: AskError };
export type SendResult = { ok: true; replayed: boolean } | { ok: false; error: AskError };

/** Only the Owner and Admin ask (the API checks again); the flag must be on. null = not allowed. */
async function token(tenantId: string, leadId: string): Promise<string | null> {
  const user = await requireUser();
  if (offerScreens() === "off" || !isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return tenant.role === "owner" || tenant.role === "admin" ? user.accessToken : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

function refusal(error: unknown): { ok: false; error: AskError } {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiContractError) return { ok: false, error: "invalid" };
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return { ok: false, error: "forbidden" };
    if (error.status === 409 && /no_consent_template/.test(error.code ?? "")) return { ok: false, error: "template" };
    if (error.status === 409 || error.status === 422) return { ok: false, error: "nothing" };
  }
  return { ok: false, error: "down" };
}

/** Reads what would be sent. Sends nothing, writes nothing. */
export async function previewConsentAskAction(tenantId: string, leadId: string): Promise<PreviewResult> {
  const t = await token(tenantId, leadId);
  if (!t) return { ok: false, error: "forbidden" };
  try {
    return { ok: true, preview: await getConsentAsk(t, tenantId, leadId) };
  } catch (error) {
    return refusal(error);
  }
}

/** The owner's tap on "Send ask" (this tap is the approval). `messageId` is the preview's own id, so a second tap is the same message. */
export async function sendConsentAskAction(tenantId: string, leadId: string, messageId: string): Promise<SendResult> {
  const t = await token(tenantId, leadId);
  if (!t) return { ok: false, error: "forbidden" };
  try {
    const r = await sendConsentAsk(t, tenantId, leadId, messageId);
    return { ok: true, replayed: r.replayed };
  } catch (error) {
    return refusal(error);
  }
}
