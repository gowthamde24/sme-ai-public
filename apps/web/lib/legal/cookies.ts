/**
 * The cookies this site sets, exactly (job BH). The one list behind the cookie settings panel and the Privacy Policy; a test checks it against the code (the three names are the constants the code
 * uses, and the sign-in cookie is the one @supabase/ssr sets with the options of lib/supabase/cookies.ts). All are strictly necessary; there are no analytics, advertising or tracking cookies.
 *
 * Settings kept in the browser's own storage (not cookies) are listed separately: they never leave the device.
 */
import { LANG_COOKIE, THEME_COOKIE } from "@/i18n/preferences";
import { CONSENT_COOKIE } from "@/lib/consent/consent";

export type CookieRow = { name: string; key: "auth" | "lang" | "theme" | "consent"; kind: "necessary" };

export const COOKIES: readonly CookieRow[] = [
  { name: "sb-<project>-auth-token", key: "auth", kind: "necessary" },
  { name: LANG_COOKIE, key: "lang", kind: "necessary" },
  { name: THEME_COOKIE, key: "theme", kind: "necessary" },
  { name: CONSENT_COOKIE, key: "consent", kind: "necessary" },
];

/** What each cookie holds and for how long, in English (the Privacy Policy text); the panel has the same in the visitor's language (legal.json: ck.*). */
export const COOKIE_FACTS = {
  auth: "Keeps you signed in and your session secure (set by our sign-in provider, Supabase; it can be split into numbered parts, and a short-lived '-code-verifier' cookie is used while you sign in). HttpOnly, SameSite=Lax, Secure on the live site. It lasts until you sign out or up to 400 days.",
  lang: "Remembers the language you chose. Holds only a language code. One year.",
  theme: "Remembers a light or dark choice, when you make one. Holds only 'light' or 'dark'. One year.",
  consent: "Remembers your cookie choice, so the notice is not shown again. One year.",
} as const;

/** Settings stored on your own device by the app (localStorage), never sent to us. */
export const DEVICE_SETTINGS = [
  { key: "sme_menu_collapsed", what: "whether the side menu is collapsed" },
  { key: "sme_office_view", what: "the view chosen on the Office page" },
  { key: "sme.contact.keepRecord", what: "whether 'keep a record' is ticked when you contact a customer" },
  { key: "sme-ask-autoplay", what: "whether spoken answers play automatically" },
  { key: "sme-ask-voice-notice", what: "that you have seen the voice privacy line" },
] as const;
