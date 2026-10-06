/** Pure helpers of the order screens (no server, no React): what a flag means in our words, and what time a person's day means. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the lifecycle flagged, in our words (the codes are the lifecycle's). A flag is a note for the owner, never an approval. */
export const FLAG_TEXT: Record<string, string> = {
  ADVANCE_OVERRIDE: "The advance had not been paid: this used the owner's override.",
  CANCELLATION_WITH_FUNDS: "This order had money in it: a refund may be owed.",
  REFUND_REQUIRES_OWNER_APPROVAL: "A refund needs the owner's attention.",
};

/** The time of occurrence a person's date means: today is the page's own render time (so a retry sends the very same value), an earlier day is noon in India. */
export function occurredAt(happenedOn: string, today: string, renderedAt: string): string | null {
  if (!DAY.test(happenedOn) || !DAY.test(today) || Number.isNaN(Date.parse(renderedAt))) return null;
  if (happenedOn > today) return null;
  return happenedOn === today ? new Date(renderedAt).toISOString() : new Date(`${happenedOn}T12:00:00+05:30`).toISOString();
}

