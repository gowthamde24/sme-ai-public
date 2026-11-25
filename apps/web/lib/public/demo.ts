import { ApiRequestError, apiPublicRequest } from "@/lib/api/client";
import { getCurrentPolicies } from "@/lib/api/policy";
import { oneLine } from "@/lib/site/lead";
import { waitlistMode } from "@/lib/waitlist/mode";
import { readContact } from "@/lib/waitlist/types";

import { TALK_TIMES, TALK_TYPES, type TalkTime, type TalkType } from "./data";

/** What a visitor may send in "Talk to us / Book a demo" and the checks on it. Every field is checked here; nothing the browser sent is trusted. */
export const MAX_TALK_NAME = 80;
export const MAX_TALK_WHAT = 200;

export type TalkInput = { name: string; phone: string | null; email: string | null; type: TalkType; time: TalkTime; what: string; lang: string };
export type TalkError = "name" | "contact" | "consent" | "rate" | "check" | "invalid" | "busy" | "down";
/** `reference` (TQ-...) is there only when the API stored the request: the page then shows it ("We received it. Reference TQ-...."). */
export type TalkResult = { ok: true; reference?: string } | { ok: false; error: TalkError };
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
 * Where a checked request goes: C1's `POST /v1/public/contact` (docs/contracts/contact-form.md; API flag CONTACT_FORM, 404 while off). The consent tick sends `consent: true` with the two versions the page showed (read from `GET /v1/policies/current`; a 409
 * `policy_version_outdated` is answered by reading them again and sending once more). The captcha was checked by the action just before (`passesTurnstile`, which uses the token up), so the API gets `captcha_token: null`, as the waitlist does. 201 `received` and 200 `duplicate` both show
 * the same thanks with the reference (nothing personal comes back). Every other answer is a plain word the form draws: 429 = rate, 400 `captcha_failed` = check, 422 = invalid, 503 `busy` = busy, anything else = down. `mock` or `off` (the waitlist's mode) keeps the request nowhere, as before.
 */
export const TALK_REFERENCE = /^TQ-[0-9A-Z]{4,16}$/;
export function contactBody(v: TalkInput, versions: { terms: string; privacy: string }): Record<string, unknown> {
  return { name: v.name, ...(v.phone ? { phone: v.phone } : {}), ...(v.email ? { email: v.email } : {}), business_kind: v.type, good_time: v.time, ...(v.what ? { sells: v.what } : {}), consent: true, terms_version: versions.terms, notice_version: versions.privacy, captcha_token: null };
}
export async function storeTalk(value: TalkInput, mode: "off" | "mock" | "on" = waitlistMode()): Promise<TalkResult> {
  if (mode !== "on") return { ok: true };
  const send = async (): Promise<unknown> => apiPublicRequest("/v1/public/contact", { method: "POST", body: contactBody(value, await getCurrentPolicies()) });
  try {
    let out: unknown;
    try {
      out = await send();
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 409 && error.code === "policy_version_outdated")) throw error;
      out = await send();
    }
    const o = typeof out === "object" && out !== null ? (out as Record<string, unknown>) : {};
    if (o.status !== "received" && o.status !== "duplicate") return { ok: false, error: "down" };
    return typeof o.reference === "string" && TALK_REFERENCE.test(o.reference) ? { ok: true, reference: o.reference } : { ok: true };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 429 || error.code === "rate_limited") return { ok: false, error: "rate" };
      if (error.code === "captcha_failed") return { ok: false, error: "check" };
      if (error.status === 422) return { ok: false, error: "invalid" };
      if (error.status === 503 && error.code === "busy") return { ok: false, error: "busy" };
    }
    return { ok: false, error: "down" };
  }
}
