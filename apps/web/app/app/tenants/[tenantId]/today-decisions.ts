import { indiaClock } from "@/components/v2/app/today/time";
import type { appT } from "@/i18n/app";
import type { OutboxMessage } from "@/lib/api/outbox";

export type Words = ReturnType<typeof appT>;

/** The note kept with a call that was not approved because the Owner chose to offer the customer a visit to the shop instead. A fixed code, not free text. */
export const OFFER_VISIT_NOTE = "offer_store_visit";
const BLOCK_KEYS = ["switch_off", "stopped", "erased", "no_phone", "no_key", "no_opt_in", "daily_limit", "send_failed", "owner_rejected"] as const;

export const customerOf = (m: { customer: string | null }, t: Words) => m.customer ?? t("today.customer.unknown");

/** What happened to a message that was just decided, in OUR words. Only a message that really went says "Sent". */
export function decidedToast(m: OutboxMessage, t: Words, now: number = Date.now()): string {
  if (m.status === "sent") return t("today.toast.sent", { customer: customerOf(m, t) });
  if (m.status === "queued") return m.scheduled_for !== null && Date.parse(m.scheduled_for) > now ? t("today.toast.queued", { time: indiaClock(m.scheduled_for) }) : t("today.toast.queuedNow");
  const key = m.status === "failed" ? "send_failed" : (BLOCK_KEYS as readonly string[]).includes(m.reason) ? m.reason : "other";
  return t("today.toast.blocked", { reason: t(`today.block.${key}` as "today.block.other") });
}

