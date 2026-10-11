"use server";

import { revalidatePath } from "next/cache";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { dispatchOutbox, getOutboxMessage, type OutboxEvent } from "@/lib/api/outbox";
import { requireUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

import { approveMessageAction, editMessageAction, rejectMessageAction } from "../today-actions";
import { dispatchWords } from "./outbox-dispatch-words";

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
 * "Send what is due now" (Owner and Admin), for THIS business: hands what is due to the channel. The outbox re-checks every rule at send time (a customer who said STOP, the daily limit, the switches), so what is "due" is only
 * what may go; messages held for quiet hours stay held until the hour they were given. The answer says, in plain words, how many went, how many failed, how many will be tried again shortly, how many are still due but were
 * not handed over, how many are held for later, and whether the whole system is stopped.
 */
export async function dispatchNowAction(tenantId: string): Promise<DecisionResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const result = await dispatchOutbox(user.accessToken, tenantId);
    refresh(tenantId);
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, message: dispatchWords(result, t) };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: t("today.err.role") };
      if (error.status === 503) return { ok: false, error: t("outbox.err.unavailable") };
    }
    return { ok: false, error: t("today.err.generic") };
  }
}

/** One message with its real history, read when its row is opened (Owner, Admin, Sales; the API refuses a Viewer). Only the events come back: the row already has the words. */
export async function outboxDetailAction(tenantId: string, id: string): Promise<{ ok: true; events: OutboxEvent[] } | { ok: false }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(id)) return { ok: false };
  try {
    const m = await getOutboxMessage(user.accessToken, tenantId, id);
    return m.events === null ? { ok: false } : { ok: true, events: m.events };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}
