"use server";

import { getSignupStatus, recordConsent, startPhone, verifyPhone, type Step } from "@/lib/api/signup-open";
import { requireUser } from "@/lib/auth/session";

/** The steps of opening sign-up (C1's docs/contracts/signup.md), as server actions: the terms and privacy ticks (with the versions IN FORCE, read here, never the browser's), the phone code and its check. Each answer is a closed word the screen draws in plain language. */
export async function acceptConsentAction(ticks: { terms: unknown; privacy: unknown }): Promise<Step> {
  const user = await requireUser();
  if (ticks.terms !== true || ticks.privacy !== true) return { ok: false, reason: "validation_error" };
  const status = await getSignupStatus(user.accessToken);
  if (!status) return { ok: false, reason: "signup_closed" };
  const a = await recordConsent(user.accessToken, "terms", status.termsVersion);
  if (!a.ok) return a;
  return recordConsent(user.accessToken, "privacy", status.privacyVersion);
}
export async function startPhoneAction(phone: unknown): Promise<Step> {
  const user = await requireUser();
  if (typeof phone !== "string" || phone.trim().length < 8 || phone.length > 20 || !/^[+\d][\d\s-]*$/.test(phone.trim())) return { ok: false, reason: "validation_error" };
  return startPhone(user.accessToken, phone.trim());
}
export async function verifyPhoneAction(code: unknown): Promise<Step> {
  const user = await requireUser();
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return { ok: false, reason: "code_wrong" };
  return verifyPhone(user.accessToken, code.trim());
}
