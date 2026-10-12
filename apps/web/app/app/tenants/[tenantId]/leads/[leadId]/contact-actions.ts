"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ContactResult } from "@/components/v2/app/contact/contact-types";
import { indiaClock } from "@/components/v2/app/today/time";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { recordTouch } from "@/lib/api/followups";
import { OUTBOX_CATEGORIES, OUTBOX_LANGUAGES, createCallRequest, submitOutboxMessage, type OutboxCategory, type OutboxLanguage, type OutboxMessage } from "@/lib/api/outbox";
import { requireUser } from "@/lib/auth/session";

import { sentRefusal } from "../../followups/sent-refusal";
import type { Say } from "@/components/v2/app/words";

const WORDS_MIN = 2;
const WORDS_MAX = 3000;
const REASON_MAX = 500;
const SCRIPT_MAX = 4000;
const BLOCK_KEYS = ["switch_off", "stopped", "erased", "no_phone", "no_key", "no_opt_in", "daily_limit", "send_failed", "owner_rejected"] as const;
const isLanguage = (v: unknown): v is OutboxLanguage => typeof v === "string" && (OUTBOX_LANGUAGES as readonly string[]).includes(v);

type Words = ReturnType<typeof appT>;

/** One sentence of OUR wording for a refusal, chosen by the API's closed status and code. A rejected session goes to sign-in. */
function failure(error: unknown, t: Words): ContactResult {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return { ok: false, error: t("today.err.role") };
    if (error.status === 404) return { ok: false, error: t("contact.err.lead") };
    if (error.code === "customer_stopped") return { ok: false, error: t("today.err.stopped") };
    if (error.status === 422 || error.code === "validation_error") return { ok: false, error: t("contact.err.invalid") };
    if (error.status === 503) return { ok: false, error: t("contact.err.unavailable") };
  }
  return { ok: false, error: t("today.err.generic") };
}

/** Where a message stands, in a closed set the screen has a sentence for. Only a message the API says is "sent" is ever called sent. */
function standing(m: OutboxMessage, t: Words, now: number): { state: "sent" | "queued" | "needs_approval" | "blocked"; text: string } {
  if (m.status === "sent") return { state: "sent", text: t("contact.state.sent") };
  if (m.status === "needs_approval") return { state: "needs_approval", text: t("contact.state.needs") };
  if (m.status === "queued") {
    return m.scheduled_for !== null && Date.parse(m.scheduled_for) > now ? { state: "queued", text: t("contact.state.queued.time", { time: indiaClock(m.scheduled_for) }) } : { state: "queued", text: t("contact.state.queued") };
  }
  const key = m.status === "failed" ? "send_failed" : (BLOCK_KEYS as readonly string[]).includes(m.reason) ? m.reason : "other";
  return { state: "blocked", text: t("contact.state.blocked", { reason: t(`today.block.${key}` as "today.block.other") }) };
}

/**
 * "Contact on WhatsApp": the person's words go to the OUTBOX for this lead (`POST /outbox/messages`), where the send policy decides whether they go now, wait for 9:00 or wait for the owner. This page never
 * holds a number and opens no WhatsApp. "Keep a record of this" controls ONE thing: whether the contact is also written to the lead's history as an outgoing touch. A touch is only made once the message
 * has REALLY gone out (the API says `sent`), never for one that is waiting, held or blocked, so the history cannot claim a contact that did not happen; the same ids make a retry safe.
 */
export async function contactWhatsAppAction(
  tenantId: string,
  leadId: string,
  input: { messageId: string; touchId: string; text: string; language: string; category: string; keepRecord: boolean },
): Promise<ContactResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(input.messageId) || !isCanonicalUuid(input.touchId)) return { ok: false, error: t("contact.err.lead") };
  if (text.length < WORDS_MIN || text.length > WORDS_MAX) return { ok: false, error: t("contact.err.words") };
  if (!isLanguage(input.language) || !(OUTBOX_CATEGORIES as readonly string[]).includes(input.category)) return { ok: false, error: t("contact.err.invalid") };
  const keep = input.keepRecord === true;
  let message: OutboxMessage;
  try {
    ({ message } = await submitOutboxMessage(user.accessToken, tenantId, { messageId: input.messageId, leadId, text, language: input.language, category: input.category as OutboxCategory }));
  } catch (error) {
    return failure(error, t);
  }
  const where = standing(message, t, Date.now());
  let record: "kept" | "off" | "later" | "failed" = keep ? "later" : "off";
  let recordError: string | null = null;
  if (message.status === "sent" && keep) {
    try {
      await recordTouch(user.accessToken, tenantId, leadId, { id: input.touchId, direction: "out", channel: "whatsapp" });
      record = "kept";
      revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}/followup`);
      revalidatePath(`/app/tenants/${tenantId}/followups`);
    } catch (error) {
      record = "failed";
      recordError = sentRefusal(error, undefined, ((key, vars) => t(key as Parameters<Words>[0], vars)) as Say)?.error ?? t("today.err.generic");
    }
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, channel: "whatsapp", state: where.state, text: where.text, record, recordText: recordText(record, recordError, t) };
}

function recordText(record: "kept" | "off" | "later" | "failed", error: string | null, t: Words): string {
  if (record === "kept") return t("contact.record.kept");
  if (record === "off") return t("contact.record.off");
  if (record === "later") return t("contact.record.later");
  return t("contact.record.failed", { reason: error ?? "" });
}

/** "Request a call": a request that goes to the owner (it appears on Today). Nothing is dialled from here and the page holds no number. A call is not a touch until it happens, so the record choice does not apply to it. */
export async function requestCallAction(tenantId: string, leadId: string, input: { requestId: string; reason: string; script: string; language: string }): Promise<ContactResult> {
  const user = await requireUser();
  const t = appT(await getLang());
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const script = typeof input.script === "string" ? input.script.trim() : "";
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(input.requestId)) return { ok: false, error: t("contact.err.lead") };
  if (reason.length < WORDS_MIN || reason.length > REASON_MAX || script.length < WORDS_MIN || script.length > SCRIPT_MAX) return { ok: false, error: t("contact.err.words") };
  if (!isLanguage(input.language)) return { ok: false, error: t("contact.err.invalid") };
  try {
    await createCallRequest(user.accessToken, tenantId, { requestId: input.requestId, leadId, reason, scriptDraft: script, language: input.language });
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, channel: "call", state: "requested", text: t("contact.state.call"), record: "off", recordText: t("contact.record.call") };
}
