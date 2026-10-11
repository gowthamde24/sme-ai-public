/** A legal document as data: sections of paragraphs, lists and tables. English only (legal text is not machine-translated). `{brand}` is replaced by the product name. */
export type Block = { p: string } | { ul: readonly string[] } | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };
export type Section = { id: string; title: string; blocks: readonly Block[] };
export type LegalText = { title: string; intro: readonly string[]; sections: readonly Section[] };

/** The placeholders only the owner can fill. They are drawn highlighted so none is missed. */
export const PLACEHOLDER = /\[(?:[A-Z][A-Z0-9 ,.'’/()-]*|(?:CONFIRM|LEGAL REVIEW)[^\]]*|\d+)\]/g;
export const OWNER_PLACEHOLDERS = ["[COMPANY NAME]", "[ADDRESS]", "[GRIEVANCE OFFICER]", "[EMAIL]", "[EFFECTIVE DATE]"] as const;
