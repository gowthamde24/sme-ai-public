
export const FOLLOWUP_ROLES = ["owner", "admin", "sales"];
export const NOTHING_SENT =
  "Follow-ups are drafts for a person to send outside this system. This system sends nothing: it keeps records of what you did and shows the closed text you copy yourself.";

/** Today's date in India. */
export function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
