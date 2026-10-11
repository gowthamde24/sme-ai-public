import { indiaClock } from "@/components/v2/app/today/time";
import type { appT } from "@/i18n/app";
import type { OutboxMessage } from "@/lib/api/outbox";

export type Words = ReturnType<typeof appT>;

const BLOCK_KEYS = ["switch_off", "stopped", "erased", "no_phone", "no_key", "no_opt_in", "daily_limit", "send_failed", "owner_rejected"] as const;

export const customerOf = (m: { customer: string | null }, t: Words) => m.customer ?? t("today.customer.unknown");

/** What happened to a message that was just decided, in OUR words. Only a message that really went says "Sent". */
export function decidedToast(m: OutboxMessage, t: Words, now: number = Date.now()): string {
  if (m.status === "sent") return t("today.toast.sent", { customer: customerOf(m, t) });
  if (m.status === "queued") return m.scheduled_for !== null && Date.parse(m.scheduled_for) > now ? t("today.toast.queued", { time: indiaClock(m.scheduled_for) }) : t("today.toast.queuedNow");
  const key = m.status === "failed" ? "send_failed" : (BLOCK_KEYS as readonly string[]).includes(m.reason) ? m.reason : "other";
  return t("today.toast.blocked", { reason: t(`today.block.${key}` as "today.block.other") });
}


/**
 * What happened to a visit offer, in OUR words: queued in the outbox (it goes by itself, waits for 9:00 or waits for a person: the outbox says which), sent, or not sent. The call is declined in
 * every case, so the toast says so; the customer is told nothing that did not go.
 */
export function offeredToast(offer: { messageStatus: "queued" | "needs_approval" | "sent" | "blocked" | "failed" }, t: Words): string {
  if (offer.messageStatus === "sent") return t("today.toast.visit.sent");
  if (offer.messageStatus === "queued" || offer.messageStatus === "needs_approval") return t("today.toast.visit");
  return t("today.toast.visit.notsent");
}
