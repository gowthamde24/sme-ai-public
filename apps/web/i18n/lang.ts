export type Lang = "en" | "te" | "hi" | "kn";
export const LANGS: readonly Lang[] = ["en", "te", "hi", "kn"];
export const LANGUAGE_NAMES: Record<Lang, { english: string; native: string }> = {
  en: { english: "English", native: "English" },
  te: { english: "Telugu", native: "తెలుగు" },
  hi: { english: "Hindi", native: "हिन्दी" },
  kn: { english: "Kannada", native: "ಕನ್ನಡ" },
};
