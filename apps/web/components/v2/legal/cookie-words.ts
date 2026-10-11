/**
 * The words of the cookie notice and settings. They live in a file of their own, NOT in CookieConsent.tsx: that is a client component, and a server file (the root layout) that imports a constant from a
 * client file gets a reference to it, not the value (components/v2/app/client-boundary.test.ts). The server resolves each key in the visitor's language (i18n/legal.ts) and hands the result down as props.
 */
export type CookieWords = Readonly<Record<string, string>>;

export const COOKIE_WORD_KEYS = [
  "cookie.notice.title", "cookie.notice.text", "cookie.notice.ok", "cookie.notice.privacy", "cookie.panel.title", "cookie.necessary.title", "cookie.necessary.text", "cookie.analytics.title", "cookie.analytics.text",
  "cookie.analytics.switch", "cookie.list.title", "cookie.col.name", "cookie.col.what", "cookie.save", "cookie.close", "cookie.ck.auth", "cookie.ck.lang", "cookie.ck.theme", "cookie.ck.consent",
] as const;

