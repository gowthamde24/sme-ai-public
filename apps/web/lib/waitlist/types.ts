import { oneLine } from "@/lib/site/lead";
import { SITE_PACKS } from "@/lib/site/packs";

/**
 * The "Book a demo / join the waitlist" form of the public site (job DQ): what a visitor may send and the checks on it. It goes to C1's POST /v1/public/waitlist (contract-dpdp.md, section 1). The marketing box is separate and never
 * ticked for the visitor: marketing_opt_in is true only when the visitor ticked it. A name, a city and a phone number or an e-mail (one of them is enough); nothing else is asked.
 */
export const WAITLIST_LANGS = ["en", "te", "hi", "kn", "ta", "ml"] as const;
export type WaitlistLang = (typeof WAITLIST_LANGS)[number];
/** Each language in its own script, for the language choice (the app itself is in four of them; a call or a message can be in six). */
export const WAITLIST_LANG_NAMES: Record<WaitlistLang, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", ta: "தமிழ்", ml: "മലയാളം" };
/** The business types that have a public page (the registry, never named here), and "other": the values contract-dpdp.md accepts. SERVER ONLY (it reads the packs). */
export const BUSINESS_TYPES: readonly string[] = [...SITE_PACKS.map((p) => p.slug), "other"];
export type BusinessType = string;

export const MAX_WAITLIST_NAME = 80;
export const MAX_WAITLIST_CITY = 80;

export type WaitlistInput = { name: string; businessType: BusinessType; city: string; phone: string | null; email: string | null; language: WaitlistLang; marketingOptIn: boolean };
export type WaitlistError = "name" | "city" | "contact" | "rate" | "down" | "invalid" | "check";
export type WaitlistResult = { ok: true } | { ok: false; error: WaitlistError };

const EMAIL = /^[^\s@<>"',;:()[\]\\]{1,64}@[^\s@<>"',;:()[\]\\]{1,190}\.[A-Za-z]{2,24}$/;
const PHONE = /^\+?\d{7,15}$/;

/** What a visitor typed into the one "phone number or e-mail" box: an e-mail address, or a phone number (spaces, dashes and brackets allowed), or neither. */
export function readContact(raw: unknown): { phone: string | null; email: string | null } | null {
  const text = oneLine(raw, 200);
  if (text === null) return null;
  if (text.includes("@")) return EMAIL.test(text) && text.length <= 254 ? { phone: null, email: text.toLowerCase() } : null;
  const digits = text.replace(/[\s().-]/g, "");
  return PHONE.test(digits) ? { phone: digits, email: null } : null;
}

/** The form's fields as the browser sent them: every one is checked here, nothing the visitor typed is trusted. */
export function readWaitlist(input: unknown): { ok: true; value: WaitlistInput } | { ok: false; error: WaitlistError } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = oneLine(raw.name, MAX_WAITLIST_NAME);
  if (name === null) return { ok: false, error: "name" };
  const city = oneLine(raw.city, MAX_WAITLIST_CITY);
  if (city === null) return { ok: false, error: "city" };
  const contact = readContact(raw.contact);
  if (contact === null) return { ok: false, error: "contact" };
  const businessType = typeof raw.businessType === "string" && BUSINESS_TYPES.includes(raw.businessType) ? raw.businessType : "other";
  const language = (WAITLIST_LANGS as readonly unknown[]).includes(raw.language) ? (raw.language as WaitlistLang) : "en";
  return { ok: true, value: { name, businessType, city, ...contact, language, marketingOptIn: raw.marketingOptIn === true } };
}
