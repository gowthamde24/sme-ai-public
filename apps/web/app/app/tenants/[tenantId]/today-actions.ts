"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { OUTBOX_LANGUAGES, approveCallRequest, approveOutboxMessage, editOutboxMessage, rejectOutboxMessage, type OutboxLanguage } from "@/lib/api/outbox";
import { offerStoreVisit } from "@/lib/api/visits";
import { requireUser } from "@/lib/auth/session";

import { customerOf, decidedToast, offeredToast, type Words } from "./today-decisions";

const WORDS_MIN = 2;
const WORDS_MAX = 3000;

/** Every failure becomes ONE sentence of OUR wording, chosen by the API's closed status and code. A rejected session goes to sign-in. */
async function failure(error: unknown, t: Words): Promise<DecisionResult> {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return { ok: false, error: t("today.err.mfa"), mfa: true };
    if (error.code === "customer_stopped") return { ok: false, error: t("today.err.stopped"), stale: true };
    if (error.code === "outbox_state" || error.status === 404 || error.status === 409) return { ok: false, error: t("today.err.state"), stale: true };
    if (error.status === 403) return { ok: false, error: t("today.err.role") };
  }
  return { ok: false, error: t("today.err.generic") };
}

async function context(tenantId: string, id: string) {
  const user = await requireUser();
  const t = appT(await getLang());
  return { user, t, valid: isCanonicalUuid(tenantId) && isCanonicalUuid(id) };
}
const refresh = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}`);

/** Owner or Admin, with the second factor: the words go to the customer through the outbox, which re-checks every rule (stopped, switched off, daily limit) before it sends. */
export async function approveMessageAction(tenantId: string, id: string): Promise<DecisionResult> {
  const { user, t, valid } = await context(tenantId, id);
  if (!valid) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const { message } = await approveOutboxMessage(user.accessToken, tenantId, id);
    refresh(tenantId);
    return { ok: true, message: decidedToast(message, t) };
  } catch (error) {
    return failure(error, t);
  }
}

/** "Not now": Owner or Admin. The message is blocked (`owner_rejected`) and never sent. */
export async function rejectMessageAction(tenantId: string, id: string): Promise<DecisionResult> {
  const { user, t, valid } = await context(tenantId, id);
  if (!valid) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const { message } = await rejectOutboxMessage(user.accessToken, tenantId, id);
    refresh(tenantId);
    return { ok: true, message: t("today.toast.rejected", { customer: customerOf(message, t) }) };
  } catch (error) {
    return failure(error, t);
  }
}

/** New words for a message that is still waiting. It stays waiting: nothing is sent by editing. */
export async function editMessageAction(tenantId: string, id: string, text: string): Promise<DecisionResult> {
  const { user, t, valid } = await context(tenantId, id);
  if (!valid) return { ok: false, error: t("today.err.state"), stale: true };
  const words = typeof text === "string" ? text.trim() : "";
  if (words.length < WORDS_MIN) return { ok: false, error: t("today.err.short") };
  if (words.length > WORDS_MAX) return { ok: false, error: t("today.err.generic") };
  try {
    const message = await editOutboxMessage(user.accessToken, tenantId, id, words);
    return { ok: true, message: t("today.toast.edited"), text: message.text };
  } catch (error) {
    return failure(error, t);
  }
}

/** The Owner only, with the second factor. Approving records the decision; nothing dials. */
export async function approveCallAction(tenantId: string, id: string): Promise<DecisionResult> {
  const { user, t, valid } = await context(tenantId, id);
  if (!valid) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const request = await approveCallRequest(user.accessToken, tenantId, id);
    refresh(tenantId);
    return { ok: true, message: t("today.toast.callok", { customer: request.customer ?? t("today.customer.unknown") }) };
  } catch (error) {
    return failure(error, t);
  }
}

/**
 * "Offer a store visit": the Owner only, with the second factor. ONE call to the API (job AS): the call request is declined with a fixed note AND the offer message (fixed words, in the language of the
 * request) is made in the outbox, where the send policy decides. The toast says where the offer stands: queued in the outbox, sent, or not sent and why.
 */
export async function offerVisitAction(tenantId: string, id: string, language: OutboxLanguage): Promise<DecisionResult> {
  const { user, t, valid } = await context(tenantId, id);
  if (!valid) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const offer = await offerStoreVisit(user.accessToken, tenantId, id, (OUTBOX_LANGUAGES as readonly string[]).includes(language) ? language : "en");
    refresh(tenantId);
    return { ok: true, message: offeredToast(offer, t) };
  } catch (error) {
    return failure(error, t);
  }
}
