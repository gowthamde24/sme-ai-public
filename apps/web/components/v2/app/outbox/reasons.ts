import { OUTBOX_TABS, type OutboxMessage, type OutboxReason, type OutboxTabName } from "@/lib/api/outbox";

/** The word key of every reason a message is in the state it is in (`outbox.reason.<reason>` in the string store). */
export const reasonKey = (r: OutboxReason) => `outbox.reason.${r}`;

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

/** The four tabs, named as the API names them (`GET /outbox/messages?tab=`: blocked also holds the messages that failed). */
export const TABS = OUTBOX_TABS;
export type OutboxTab = OutboxTabName;

/** The first non-empty line of the words, for the list. */
export function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
}
