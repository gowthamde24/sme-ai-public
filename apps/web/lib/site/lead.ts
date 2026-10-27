import type { Lang } from "@/i18n/lang";
import { LANGS } from "@/i18n/lang";

/**
 * Pure checks for the two ways a visitor starts a WhatsApp chat with us (job CM): the contact form and the calculator's "Get exact quote on WhatsApp". Nothing is stored: the server checks the input, counts the try against
 * a per-address limit, and hands back the `wa.me` address of OUR number with the message filled in; the visitor sends it from their own phone, so the enquiry arrives as a message in the business's own WhatsApp inbox.
 * A visitor's input is whatever the browser sent: every field is checked here, the message is built on the server from checked pieces, and nothing the visitor typed is trusted as a number or an address.
 */
export const MAX_NAME = 80;
export const MAX_CITY = 60;
export const MAX_QUESTION = 400;

// control characters, line and paragraph separators and the invisible direction marks: all become a space
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** One line of plain text: control characters and line breaks become spaces, runs of spaces collapse, at most `max` characters; null when nothing is left. */
export function oneLine(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFKC").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return [...text].slice(0, max).join("");
}

export const readSiteLang = (raw: unknown): Lang => (typeof raw === "string" && (LANGS as readonly string[]).includes(raw) ? (raw as Lang) : "en");

export type LeadError = "consent" | "name" | "rate" | "unavailable" | "invalid" | "check";
export type LeadResult = { ok: true; url: string } | { ok: false; error: LeadError };

/** The consent box arrives as "on" from a checkbox or true from a script; anything else is no consent. */
export const consented = (raw: unknown): boolean => raw === true || raw === "on" || raw === "true";
