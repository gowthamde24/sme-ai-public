/**
 * The number picker (owner, 28 Nov 2026; mock "Phone numbers"; C1's contract note reports/number-picker-contract-note.md): the owner picks their own business number from a list, like in the phone company's portal.
 * Rules of the screen: a number is always shown as `+91 XXXXX XXXXX`; there is NEVER a price here (ours or the phone company's); the words are plain (no "DID", no "channel"). The server decides everything (the plan,
 * the daily cap, the wallet); the screen only explains the reason in plain words.
 */
export const NUMBER_TYPES = ["mobile", "landline"] as const;
export type NumberType = (typeof NUMBER_TYPES)[number];
/** `kyc_pending` (C1, business-kyc.md: buy first, verify after): bought and attached with calls OFF, but the business is not verified yet, so the API refuses real calls to and from it until it is. */
export const NUMBER_STATES = ["getting_ready", "kyc_pending", "ready", "calls_off", "calls_on"] as const;
export type NumberState = (typeof NUMBER_STATES)[number];
/** Why the picker is off or a number cannot be added now (`409 numbers_unavailable`, `fields: ["reason"]`). */
export const UNAVAILABLE_REASONS = ["not_on_plan", "already_has_number", "paused", "wallet_low", "daily_limit", "kyc_required"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** A number for sale: `number` is +91 and ten digits, `display` is how it is drawn. */
export type PickNumber = { number: string; display: string; type: NumberType };
/** A number of the workspace and where it stands. */
export type OwnNumber = PickNumber & { state: NumberState; label: string | null };

/** Why a move did not happen: closed words, drawn in plain language by the screen (never the server's own text). */
export type Refusal = { ok: false; error: "invalid" | "forbidden" | "step_up" | "taken" | "unavailable" | "down"; reason?: UnavailableReason };
export type SearchResult = { ok: true; numbers: PickNumber[]; page: number; more: boolean } | Refusal;
export type ClaimResult = { ok: true; number: OwnNumber } | Refusal;

const E164 = /^\+91\d{10}$/;
export const isNumber = (v: unknown): v is string => typeof v === "string" && E164.test(v);
export const isType = (v: unknown): v is NumberType => typeof v === "string" && (NUMBER_TYPES as readonly string[]).includes(v);
/** The digits a number starts with: 1 to 6 digits, or nothing. */
export const isPrefix = (v: unknown): v is string => typeof v === "string" && /^\d{0,6}$/.test(v);

/** "+919876543210" -> "+91 98765 43210". Anything else is returned as it is (never guessed). */
export function displayNumber(number: string): string {
  return isNumber(number) ? `+91 ${number.slice(3, 8)} ${number.slice(8)}` : number;
}

/** The forwarding codes (standard GSM conditional forwarding: "when I do not answer"); `null` = no standard code to show, the text says where to look. */
export const COMPANIES = ["airtel", "vi", "bsnl", "jio"] as const;
export type Company = (typeof COMPANIES)[number];
export const forwardCode = (company: Company, number: string): { on: string; off: string } | null => (company === "jio" || !isNumber(number) ? null : { on: `**61*${number}#`, off: "##61#" });
