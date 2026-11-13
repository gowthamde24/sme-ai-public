/**
 * Why a staff member opens a business (C1's `reason_code`s of `POST /v1/admin/access`). The reason is chosen BEFORE any data is shown; "Something else" needs words (3 to 300 characters). The shop owner sees it in their activity log. Client-safe: no request API, nothing imported.
 */
export const REASONS = [
  { code: "support_ticket", label: "A support ticket" },
  { code: "customer_asked", label: "The business asked me to look" },
  { code: "privacy_request", label: "A privacy request" },
  { code: "incident", label: "An incident or outage" },
  { code: "billing_dispute", label: "A billing question" },
  { code: "other", label: "Something else (say what)" },
] as const;
export type ReasonCode = (typeof REASONS)[number]["code"];
export const NOTE_MIN = 3;
export const NOTE_MAX = 300;

/** The refusal to show inline before anything is sent: a reason is chosen, and "something else" says what. null = good to send. */
export function reasonProblem(code: string, note: string): "choose" | "say_what" | null {
  if (!REASONS.some((r) => r.code === code)) return "choose";
  if (code === "other" && (note.trim().length < NOTE_MIN || note.trim().length > NOTE_MAX)) return "say_what";
  return null;
}
