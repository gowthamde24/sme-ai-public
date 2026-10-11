"use server";

import { revalidatePath } from "next/cache";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { dispatchOutbox } from "@/lib/api/outbox";
import { requireUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

import { approveMessageAction, editMessageAction, rejectMessageAction } from "../today-actions";

const refresh = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/outbox`);

/** Approve and send, from the Outbox: the same decision as on Today (Owner or Admin, second factor; the outbox re-checks every rule), then the Outbox is read again. */
export async function approveFromOutboxAction(tenantId: string, id: string): Promise<DecisionResult> {
  const r = await approveMessageAction(tenantId, id);
  refresh(tenantId);
  return r;
}

/** "Not now", from the Outbox: the message is blocked and never sent. */
export async function rejectFromOutboxAction(tenantId: string, id: string): Promise<DecisionResult> {
  const r = await rejectMessageAction(tenantId, id);
  refresh(tenantId);
  return r;
}

/** New words for a message that is still waiting. It stays waiting: nothing is sent by editing. */
export async function editFromOutboxAction(tenantId: string, id: string, text: string): Promise<DecisionResult> {
  return editMessageAction(tenantId, id, text);
}

/**
 * "Send what is due now" (Owner and Admin): hands what is due to the channel. The outbox re-checks every rule at send time (a customer who said STOP, the daily limit, the switches), so what is "due" is only what
 * may go; messages held for quiet hours stay held until 9:00. The answer says how many went and how many failed, and nothing else.
 */
export async function dispatchNowAction(tenantId: string): Promise<DecisionResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const { sent, failed } = await dispatchOutbox(user.accessToken, tenantId);
    refresh(tenantId);
    revalidatePath(`/app/tenants/${tenantId}`);
    if (sent === 0 && failed === 0) return { ok: true, message: t("outbox.dispatch.none") };
    return { ok: true, message: failed > 0 ? t("outbox.dispatch.some", { sent, failed }) : t("outbox.dispatch.sent", { sent }) };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: t("today.err.role") };
      if (error.status === 503) return { ok: false, error: t("outbox.err.unavailable") };
    }
    return { ok: false, error: t("today.err.generic") };
  }
}
