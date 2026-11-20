import { LANGUAGE_NAMES, type SiteLang } from "@/i18n/lang";

/**
 * The languages of the PUBLIC SITE as runtime values (the type `SiteLang` lives in i18n/lang.ts). A file of its own on purpose: the app's script must not carry them (the route-JS ceilings): only the website's modules import this file.
 */
export const SITE_LANGS: readonly SiteLang[] = ["en", "te", "hi", "kn", "ta"];
export const SITE_LANGUAGE_NAMES: Record<SiteLang, { english: string; native: string }> = { ...LANGUAGE_NAMES, ta: { english: "Tamil", native: "தமிழ்" } };
export const isSiteLang = (v: unknown): v is SiteLang => typeof v === "string" && (SITE_LANGS as readonly string[]).includes(v);

/** The language cookie as the PUBLIC SITE reads it (the home page at "/", the legal pages, the cookie notice): the four product languages and Tamil. The app reads `readLang`, so a Tamil choice leaves the app in English. */
export const readSiteLangCookie = (raw: string | undefined | null): SiteLang => ((SITE_LANGS as readonly string[]).includes(raw ?? "") ? (raw as SiteLang) : "en");
