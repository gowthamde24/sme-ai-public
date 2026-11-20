export type Lang = "en" | "te" | "hi" | "kn";
export const LANGS: readonly Lang[] = ["en", "te", "hi", "kn"];
export const LANGUAGE_NAMES: Record<Lang, { english: string; native: string }> = {
  en: { english: "English", native: "English" },
  te: { english: "Telugu", native: "తెలుగు" },
  hi: { english: "Hindi", native: "हिन्दी" },
  kn: { english: "Kannada", native: "ಕನ್ನಡ" },
};

/**
 * The languages of the PUBLIC SITE (the website): the four product languages and Tamil (owner, 20 Nov 2026: Tamil on the public site). The product itself (the app, the assistant, the calls) speaks `Lang` only; Tamil exists in the site's words, its
 * addresses ("/ta"), its fonts and the legal page labels. A site string without a Tamil text shows its English.
 */
export type SiteLang = Lang | "ta";
