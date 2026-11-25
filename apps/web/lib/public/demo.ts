import { oneLine } from "@/lib/site/lead";
import { readContact } from "@/lib/waitlist/types";

import { TALK_TIMES, TALK_TYPES, type TalkTime, type TalkType } from "./data";

/** What a visitor may send in "Talk to us / Book a demo" and the checks on it. Every field is checked here; nothing the browser sent is trusted. */
export const MAX_TALK_NAME = 80;
export const MAX_TALK_WHAT = 200;

export type TalkInput = { name: string; phone: string | null; email: string | null; type: TalkType; time: TalkTime; what: string; lang: string };
export type TalkError = "name" | "contact" | "consent" | "rate" | "check" | "invalid";
export type TalkResult = { ok: true } | { ok: false; error: TalkError };
export type TalkAction = (input: unknown) => Promise<TalkResult>;

export function readTalk(input: unknown): { ok: true; value: TalkInput } | { ok: false; error: TalkError } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const name = oneLine(raw.name, MAX_TALK_NAME);
  if (name === null) return { ok: false, error: "name" };
  const contact = readContact(raw.contact);
  if (contact === null) return { ok: false, error: "contact" };
  if (raw.consent !== true) return { ok: false, error: "consent" };
  const type = (TALK_TYPES as readonly unknown[]).includes(raw.type) ? (raw.type as TalkType) : "other";
  const time = (TALK_TIMES as readonly unknown[]).includes(raw.time) ? (raw.time as TalkTime) : "morning";
  const what = oneLine(raw.what, MAX_TALK_WHAT) ?? "";
  const lang = typeof raw.lang === "string" && /^[a-z]{2}$/.test(raw.lang) ? raw.lang : "en";
  return { ok: true, value: { name, ...contact, type, time, what, lang } };
}

/**
 * Where a checked request goes. TODAY NOTHING IS STORED: there is no contact route in the API yet (C1 has the waitlist route only), so this keeps the request nowhere and the page says "if you do not hear from us within a day, write to hello@".
 * When the API has a contact route, call it here (one place) and nothing else changes.
 */
export async function storeTalk(_value: TalkInput): Promise<TalkResult> {
  return { ok: true };
}
