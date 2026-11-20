export type Lang = "en" | "te" | "hi" | "kn";
export const LANGS: readonly Lang[] = ["en", "te", "hi", "kn"];
export const LANGUAGE_NAMES: Record<Lang, { english: string; native: string }> = {
  en: { english: "English", native: "English" },
  te: { english: "Telugu", native: "తెలుగు" },
  hi: { english: "Hindi", native: "हिन्दी" },
  kn: { english: "Kannada", native: "ಕನ್ನಡ" },
};

/**
 * The languages of the PUBLIC SITE (stack19.com): the four product languages and Tamil (owner, 20 Nov 2026: Tamil on the public site). The product itself (the app, the assistant, the calls) speaks `Lang` only; Tamil exists in the site's words, its
 * addresses ("/ta"), its fonts and the legal page labels. A site string without a Tamil text shows its English.
 */
export type SiteLang = Lang | "ta";
export const SITE_LANGS: readonly SiteLang[] = ["en", "te", "hi", "kn", "ta"];
export const SITE_LANGUAGE_NAMES: Record<SiteLang, { english: string; native: string }> = { ...LANGUAGE_NAMES, ta: { english: "Tamil", native: "தமிழ்" } };
export const isSiteLang = (v: unknown): v is SiteLang => typeof v === "string" && (SITE_LANGS as readonly string[]).includes(v);
