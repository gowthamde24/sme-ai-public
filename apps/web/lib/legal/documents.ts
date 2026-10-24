import { BRAND_TEXT } from "@/design/brand";
import type { Lang } from "@/i18n/lang";
import { LEGAL_TOKENS } from "@/lib/site/business";

import { DATA_DELETION } from "./data-deletion-text";
import { DATA_DELETION_HI } from "./data-deletion-text.hi";
import { DATA_DELETION_KN } from "./data-deletion-text.kn";
import { DATA_DELETION_TE } from "./data-deletion-text.te";
import { PRIVACY } from "./privacy-text";
import { PRIVACY_HI } from "./privacy-text.hi";
import { PRIVACY_KN } from "./privacy-text.kn";
import { PRIVACY_TE } from "./privacy-text.te";
import { TERMS } from "./terms-text";
import type { LegalText } from "./types";

/**
 * The legal documents by name and language (job DB). The Privacy Policy and the data-deletion page exist in all four languages; the Terms of Use are English only (its page opens with a short summary in the visitor's language).
 * The Telugu, Hindi and Kannada texts are machine-written drafts awaiting a native reader: the page says so (legal.translated.note) and the English text is the one that counts. SERVER ONLY: all four texts are large.
 */
export type DocId = "privacy" | "terms" | "data-deletion";

const DOCS: Record<DocId, { en: LegalText } & Partial<Record<Exclude<Lang, "en">, LegalText>>> = {
  privacy: { en: PRIVACY, te: PRIVACY_TE, hi: PRIVACY_HI, kn: PRIVACY_KN },
  terms: { en: TERMS },
  "data-deletion": { en: DATA_DELETION, te: DATA_DELETION_TE, hi: DATA_DELETION_HI, kn: DATA_DELETION_KN },
};

/** The text in the visitor's language, or English where there is none; `lang` is the language the returned text is really in. */
export function legalDocument(id: DocId, lang: Lang): { doc: LegalText; lang: Lang } {
  const doc = lang === "en" ? undefined : DOCS[id][lang];
  return doc ? { doc, lang } : { doc: DOCS[id].en, lang: "en" };
}

export const languagesOf = (id: DocId): Lang[] => (["en", ...(["te", "hi", "kn"] as const).filter((l) => DOCS[id][l])] as Lang[]);

/** A text with {brand} and the other {tokens} of lib/site/business.ts filled in (the facts are written there once). An unknown {word} stays as it is, so a typo shows on the page and a test catches it. */
export function fillLegal(text: string): string {
  const all: Record<string, string> = { brand: BRAND_TEXT, ...LEGAL_TOKENS };
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => all[key] ?? whole);
}
