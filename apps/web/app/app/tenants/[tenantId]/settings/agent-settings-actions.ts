"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { AgentResult } from "@/components/v2/app/agent-settings/types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { putOutboxSettings } from "@/lib/api/outbox";
import { EVENING_HOURS, HEADS_UP_MINUTES, NO_SHOW_MINUTES, putSchedulerSettings, type SchedulerSettings } from "@/lib/api/scheduler";
import { requireUser } from "@/lib/auth/session";

type Words = ReturnType<typeof appT>;

/** Every failure becomes ONE sentence of OUR wording, chosen by the API's closed status and code. A rejected session goes to sign-in. */
function failure(error: unknown, t: Words): AgentResult {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return { ok: false, error: t("today.err.mfa"), mfa: true };
    if (error.status === 403) return { ok: false, error: t("agentset.err.owner") };
    if (error.status === 422 || error.code === "validation_error") return { ok: false, error: t("agentset.err.invalid") };
    if (error.status === 503) return { ok: false, error: t("agentset.err.unavailable") };
  }
  return { ok: false, error: t("today.err.generic") };
}

const within = (v: unknown, r: { min: number; max: number }) => typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;

/** Automatic sending on or off for this business, and the daily limit per customer. The Owner only, with the second factor (the API checks). Off until the Owner turns it on. */
export async function saveSendingAction(tenantId: string, input: { auto_send_enabled: boolean; per_customer_daily_limit: number }): Promise<AgentResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId) || typeof input?.auto_send_enabled !== "boolean" || !within(input.per_customer_daily_limit, { min: 1, max: 20 })) return { ok: false, error: t("agentset.err.invalid") };
  try {
    const saved = await putOutboxSettings(user.accessToken, tenantId, { auto_send_enabled: input.auto_send_enabled, per_customer_daily_limit: input.per_customer_daily_limit });
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    revalidatePath(`/app/tenants/${tenantId}/outbox`);
    return { ok: true, message: t(saved.auto_send_enabled ? "agentset.saved.on" : "agentset.saved.off") };
  } catch (error) {
    return failure(error, t);
  }
}

/** The reminders and the automatic no-show, the whole set at once. The Owner only, with the second factor. It changes no message that is already queued. */
export async function saveRemindersAction(tenantId: string, input: Omit<SchedulerSettings, "is_default">): Promise<AgentResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  const ok =
    isCanonicalUuid(tenantId) &&
    typeof input?.reminder_evening_enabled === "boolean" &&
    typeof input.reminder_heads_up_enabled === "boolean" &&
    typeof input.no_show_enabled === "boolean" &&
    within(input.reminder_evening_hour, EVENING_HOURS) &&
    within(input.reminder_heads_up_minutes, HEADS_UP_MINUTES) &&
    within(input.no_show_after_minutes, NO_SHOW_MINUTES);
  if (!ok) return { ok: false, error: t("agentset.err.invalid") };
  try {
    await putSchedulerSettings(user.accessToken, tenantId, input);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, message: t("agentset.saved.reminders") };
  } catch (error) {
    return failure(error, t);
  }
}
