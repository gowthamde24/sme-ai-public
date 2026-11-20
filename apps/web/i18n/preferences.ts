import { LANGS, SITE_LANGS, type Lang, type SiteLang } from "@/i18n/lang";

/**
 * The two functional preference cookies of the public pages (owner decision, 2026-10-07): language and theme.
 * Read on the server (values are allow-listed, anything else is ignored) and written by the two header controls.
 * Path=/, SameSite=Lax, one year, Secure only when the page is served over https. They hold a preference, nothing else.
 */
export const LANG_COOKIE = "sme_lang";
export const THEME_COOKIE = "sme_theme";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

export const readLang = (raw: string | undefined | null): Lang => ((LANGS as readonly string[]).includes(raw ?? "") ? (raw as Lang) : "en");

/** The language cookie as the PUBLIC SITE reads it (the home page at "/", the legal pages, the cookie notice): the four product languages and Tamil. The app reads `readLang`, so a Tamil choice leaves the app in English. */
export const readSiteLangCookie = (raw: string | undefined | null): SiteLang => ((SITE_LANGS as readonly string[]).includes(raw ?? "") ? (raw as SiteLang) : "en");

/** The chosen theme, or undefined: no choice means "follow the system". */
export const readTheme = (raw: string | undefined | null): Theme | undefined => ((THEMES as readonly string[]).includes(raw ?? "") ? (raw as Theme) : undefined);

/** The document.cookie string for a preference. `https` decides the Secure attribute. */
export function serializePreference(name: typeof LANG_COOKIE | typeof THEME_COOKIE, value: string, https: boolean): string {
  return `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${https ? "; Secure" : ""}`;
}
