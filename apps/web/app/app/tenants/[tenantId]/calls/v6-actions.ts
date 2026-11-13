"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { whisperCall } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { approveQuote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { designV6 } from "@/lib/screens/flag";

import { approveMaterialQuoteAction } from "../quotes/material-actions";

/**
 * The two moves of the Calls panel that are new in design system v6 (the others, End call, Correct it and Take over, are the ones the call page already had):
 * - "Approve" on the quote a call left behind (Owner and Admin, second factor, as everywhere): the quote is approved and NOTHING is sent. The words go out only when the owner opens WhatsApp from the approved quote (the quote's own redirect route) and presses send there.
 * - "Whisper" on a live call (Owner and Admin; C1's POST /calls/{id}/whisper): only the assistant hears it, from its next sentence.
 * Every answer is a sentence of ours, chosen by the API's closed status and code; nothing the API or a customer wrote is echoed.
 */
export async function approveCallQuoteAction(tenantId: string, quoteId: string, type: string): Promise<DecisionResult> {
  const t = appT(await getLang());
  if (!designV6() || !isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId) || (type !== "quote" && type !== "material_quote")) return { ok: false, error: t("today.err.state"), stale: true };
  if (type === "material_quote") {
    const r = await approveMaterialQuoteAction(tenantId, quoteId);
    if (r.ok) {
      revalidatePath(`/app/tenants/${tenantId}/calls`);
      return { ok: true, message: t("calls6.quote.approved.toast") };
    }
    return { ok: false, error: r.error, ...(r.mfa ? { mfa: true } : {}), ...(r.stale ? { stale: true } : {}) };
  }
  const user = await requireUser();
  try {
    await approveQuote(user.accessToken, tenantId, quoteId);
    revalidatePath(`/app/tenants/${tenantId}/calls`);
    return { ok: true, message: t("calls6.quote.approved.toast") };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "mfa_required") return { ok: false, error: t("today.err.mfa"), mfa: true };
      if (error.status === 404 || error.status === 409) return { ok: false, error: t("today.err.state"), stale: true };
      if (error.status === 403) return { ok: false, error: t("today.err.role") };
    }
    return { ok: false, error: t("today.err.generic") };
  }
}

export type WhisperResult = { ok: true } | { ok: false; error: "forbidden" | "empty" | "not_here" | "not_available" | "down" };
export async function whisperCallAction(tenantId: string, callId: string, text: unknown): Promise<WhisperResult> {
  if (!designV6()) return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId)) return { ok: false, error: "forbidden" };
  const words = typeof text === "string" ? text.trim() : "";
  if (words.length < 1 || words.length > 300) return { ok: false, error: "empty" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
    await whisperCall(user.accessToken, tenantId, callId, words);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "call_not_here" || error.status === 409) return { ok: false, error: "not_here" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404 || error.status === 405) return { ok: false, error: "not_available" };
    }
    return { ok: false, error: "down" };
  }
}
