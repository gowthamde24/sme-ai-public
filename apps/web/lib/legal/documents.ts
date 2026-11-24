import { BRAND_TEXT } from "@/design/brand";
import type { SiteLang } from "@/i18n/lang";
import { TRIAL_DAYS } from "@/lib/plan/trial-days";
import { LEGAL_TOKENS } from "@/lib/site/business";

import { DATA_DELETION } from "./data-deletion-text";
import { DATA_DELETION_HI } from "./data-deletion-text.hi";
import { DATA_DELETION_KN } from "./data-deletion-text.kn";
import { DATA_DELETION_TE } from "./data-deletion-text.te";
import { AUP } from "./aup-text";
import { PRIVACY } from "./privacy-text";
import { REFUND } from "./refund-text";
import { TERMS } from "./terms-text";
import type { LegalText } from "./types";

/**
 * The legal documents by name and language (job DB). The data-deletion page exists in all four languages; the Privacy notice and the Terms of Use are English only (owner, 18 Nov: no translation of legal text until the owner approves one) (its page opens with a short summary in the visitor's language).
 * The Telugu, Hindi and Kannada texts are machine-written drafts awaiting a native reader: the page says so (legal.translated.note) and the English text is the one that counts. SERVER ONLY: all four texts are large.
 */
export type DocId = "privacy" | "terms" | "data-deletion" | "refund" | "aup";

const DOCS: Record<DocId, { en: LegalText } & Partial<Record<Exclude<SiteLang, "en">, LegalText>>> = {
  privacy: { en: PRIVACY }, // English only until the owner approves a translation (18 Nov 2026); privacy-text.te/.hi/.kn.ts keep the same English for the review kit
  terms: { en: TERMS },
  refund: { en: REFUND },
  aup: { en: AUP },
  "data-deletion": { en: DATA_DELETION, te: DATA_DELETION_TE, hi: DATA_DELETION_HI, kn: DATA_DELETION_KN },
};

/**
 * Tamil (a language of the public website only) has NO legal words: the legal pages stay English and carry ONE plain Tamil line, "this page is in English" (owner-gated: no Tamil legal text ships until the owner approves it; a draft like the rest of the Tamil).
 * Every other word of a legal page, for a Tamil visitor, is English (`legalLang`).
 */
export const LEGAL_ENGLISH_ONLY_TA = "இந்தப் பக்கம் ஆங்கிலத்தில் உள்ளது";
export const legalLang = (lang: SiteLang): SiteLang => (lang === "ta" ? "en" : lang);

/** The text in the visitor's language, or English where there is none; `lang` is the language the returned text is really in. */
export function legalDocument(id: DocId, lang: SiteLang): { doc: LegalText; lang: SiteLang } {
  const doc = lang === "en" ? undefined : DOCS[id][lang];
  return doc ? { doc, lang } : { doc: DOCS[id].en, lang: "en" };
}

export const languagesOf = (id: DocId): SiteLang[] => (["en", ...(["te", "hi", "kn"] as const).filter((l) => DOCS[id][l])] as SiteLang[]);

/** A text with {brand} and the other {tokens} of lib/site/business.ts filled in (the facts are written there once). An unknown {word} stays as it is, so a typo shows on the page and a test catches it. */
export function fillLegal(text: string): string {
  const all: Record<string, string> = { brand: BRAND_TEXT, trial_days: String(TRIAL_DAYS), ...LEGAL_TOKENS };
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => all[key] ?? whole);
}
