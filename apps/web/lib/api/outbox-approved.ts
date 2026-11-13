import type { OutboxMessage } from "./outbox";

/**
 * A message the person approved that the system has not sent: the only kind that may be opened in the person's own WhatsApp (status queued with a decision that is not a rejection). The API says the same on `mark-sent` (409 `not_approved` / `already_sent`);
 * this only decides whether the screen offers the button. A plain module with no imports of values, so a client component may use it.
 */
export const approvedNotSent = (m: Pick<OutboxMessage, "status" | "decided_at" | "reason">): boolean => m.status === "queued" && m.decided_at !== null && m.reason !== "owner_rejected";
