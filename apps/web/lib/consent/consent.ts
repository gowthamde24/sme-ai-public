/**
 * The visitor's cookie choice (job BH). One small cookie, `sme_consent`, holds it: `1.a0` or `1.a1` (format 1; analytics off or on). No cookie means "not asked yet": the notice is
 * shown once. The cookie itself is strictly necessary (it only remembers the choice). Read on the server (so the notice is never drawn for someone who has answered, and never flickers)
 * and written by the browser. Anything that is not exactly one of the two values is "not asked".
 *
 * ANALYTICS is the one optional category. It is OFF unless the visitor turns it on, and nothing in this app loads any analytics at all today: the category exists so that, if it is ever
 * added, it can only run behind `analyticsAllowed()` (lib/consent/analytics.ts). A test fails if an analytics library or tag appears in the source.
 */
export const CONSENT_COOKIE = "sme_consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export type Consent = { /** The visitor has answered (OK or Save). */ decided: boolean; analytics: boolean };
export const NOT_ASKED: Consent = { decided: false, analytics: false };

export function readConsent(raw: string | undefined | null): Consent {
  if (raw === "1.a0") return { decided: true, analytics: false };
  if (raw === "1.a1") return { decided: true, analytics: true };
  return NOT_ASKED;
}

export const consentValue = (analytics: boolean): string => (analytics ? "1.a1" : "1.a0");

/** The `document.cookie` string that records a choice. `https` decides Secure. */
export function serializeConsent(analytics: boolean, https: boolean): string {
  return `${CONSENT_COOKIE}=${consentValue(analytics)}; Path=/; SameSite=Lax; Max-Age=${CONSENT_MAX_AGE}${https ? "; Secure" : ""}`;
}

/** The value of one cookie out of a `document.cookie` string, or undefined. */
export function cookieFrom(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
