import { OUTBOX_REASONS, type OutboxMessage, type OutboxReason } from "@/lib/api/outbox";

/** The word key of every reason a message is in the state it is in (`outbox.reason.<reason>` in the string store). */
export const reasonKey = (r: OutboxReason) => `outbox.reason.${r}`;
export const ALL_REASON_KEYS = OUTBOX_REASONS.map(reasonKey);

/**
 * The colour of a state's chip: a message that waits for a person is amber, one that is held or queued is blue, one that went is green, one that did not (blocked or failed) is red. The chip says WHY in plain words
 * (`outbox.reason.*`), so the colour is only a hint: nothing is said by colour alone.
 */
export function toneOf(m: Pick<OutboxMessage, "status">): string {
  switch (m.status) {
    case "needs_approval":
      return "bg-amber-bg text-amber-text";
    case "queued":
      return "bg-info-bg text-info-text";
    case "sent":
      return "bg-green-bg text-green-text";
    default:
      return "bg-red-bg text-red-text";
  }
}

/** The four tabs and the API's statuses each one reads (`GET /outbox/messages?status=`). */
export const TABS = ["waiting", "scheduled", "sent", "blocked"] as const;
export type OutboxTab = (typeof TABS)[number];
export const TAB_STATUSES: Record<OutboxTab, readonly OutboxMessage["status"][]> = {
  waiting: ["needs_approval"],
  scheduled: ["queued"],
  sent: ["sent"],
  blocked: ["blocked", "failed"],
};

/** The first non-empty line of the words, for the list. */
export function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
}
