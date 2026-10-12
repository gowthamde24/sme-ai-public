import type { Say } from "../words";

/** The closed codes the privacy routes answer with, and the sentence for each (the API's own sentences are never shown). */
export const PRIVACY_CODES = ["privacy_state", "privacy_rate_limited", "storage_unavailable", "privacy_unavailable", "sole_owner", "confirmation_mismatch", "cooling_off", "role_not_allowed"] as const;

export function privacySentence(code: string, t: Say): string | null {
  return (PRIVACY_CODES as readonly string[]).includes(code) ? t(`prx.err.${code}`) : null;
}

/** The typed confirmation matches (the e-mail in any case, the workspace name as it is written; spaces at the ends do not count). */
export function confirms(typed: string, expected: string, caseInsensitive: boolean): boolean {
  const a = typed.trim();
  const b = expected.trim();
  if (b === "") return false;
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when the time has passed (the cooling-off of a deletion is over). */
export const passed = (iso: string, now: number): boolean => Date.parse(iso) <= now;

/** The seconds to wait between two looks at an export that is being made, and the longest we keep looking. */
export const POLL_MS = 3000;
export const POLL_GIVE_UP_MS = 5 * 60_000;
export const ACTIVE = ["queued", "running"] as const;

export function exportStateWord(status: string, errorCode: string | null, t: Say): string {
  if (status === "failed") return errorCode === "too_large" ? t("prx.exp.failed.too_large") : t("prx.exp.failed");
  return t(`prx.exp.status.${status}`);
}
