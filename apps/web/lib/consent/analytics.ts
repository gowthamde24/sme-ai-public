import { cookieFrom, CONSENT_COOKIE, readConsent } from "./consent";

/**
 * The only door to analytics (job BH). Nothing in this app loads analytics today: no script, no tag, no request. If it is ever added, its loader must be started with
 * `whenAnalyticsAllowed(load)` and nowhere else, so it runs only for a visitor who switched the Analytics category on, and never on the server.
 */
export function analyticsAllowed(cookieHeader?: string): boolean {
  const header = cookieHeader ?? (typeof document === "undefined" ? "" : document.cookie);
  return readConsent(cookieFrom(header, CONSENT_COOKIE)).analytics;
}

/** Runs `load` (which would add an analytics script) only if the visitor allowed it. Returns whether it ran. */
export function whenAnalyticsAllowed(load: () => void): boolean {
  if (typeof window === "undefined" || !analyticsAllowed()) return false;
  load();
  return true;
}
