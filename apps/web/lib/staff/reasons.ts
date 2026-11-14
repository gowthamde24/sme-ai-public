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

/** Goodwill credit (C1 slice 3): whole rupees, ₹100 to ₹1,000 a time. Money is typed in rupees and sent in paise. */
export const GOODWILL_MIN_RUPEES = 100;
export const GOODWILL_MAX_RUPEES = 1000;

/** "500" or "1,000" or "₹500" -> 50000 paise; null for anything that is not a whole number of rupees in range. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, "");
  if (!/^\d{1,5}$/.test(clean)) return null;
  const rupees = Number(clean);
  return rupees >= GOODWILL_MIN_RUPEES && rupees <= GOODWILL_MAX_RUPEES ? rupees * 100 : null;
}

/** For money and for unmasking the words are ALWAYS needed (3 to 300 characters), whatever the reason code. */
export function wordsProblem(code: string, note: string): "choose" | "say_what" | null {
  if (!REASONS.some((r) => r.code === code)) return "choose";
  const n = note.trim().length;
  return n < NOTE_MIN || n > NOTE_MAX ? "say_what" : null;
}

/** One key per click (8 to 64 of A-Z a-z 0-9 _ -): a retry of the SAME click sends the same key and credits nothing twice. */
export const newCreditKey = (): string => `gw-${crypto.randomUUID()}`;
