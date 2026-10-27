import { CALL_LANGS, type CallLang } from "./types";

/** The language of a screen (en/te/hi/kn) as the default language of a call: the customers are very likely to speak what the owner reads. Anything else is English. */
export const assistantLangOf = (lang: string): CallLang => ((CALL_LANGS as readonly string[]).includes(lang) ? (lang as CallLang) : "en");
