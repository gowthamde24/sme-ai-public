/**
 * A legal document as data: sections of paragraphs, lists and tables. English is the text that counts; the Privacy Policy and the data-deletion page also exist in Telugu, Hindi and Kannada, as machine-written drafts awaiting a native reader
 * (lib/legal/documents.ts). `{brand}` is replaced by the product name and the other {tokens} by the facts of lib/site/business.ts, when a document is drawn.
 */
export type Block = { p: string } | { ul: readonly string[] } | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };
export type Section = { id: string; title: string; blocks: readonly Block[] };
export type LegalText = { title: string; intro: readonly string[]; sections: readonly Section[] };

/** A fact still missing from a text is written in capitals between square brackets, and the page draws it highlighted so none is missed. (No text has one today; a test keeps it so.) */
export const PLACEHOLDER = /\[(?:[A-Z][A-Z0-9 ,.'’/()-]*|(?:CONFIRM|LEGAL REVIEW)[^\]]*|\d+)\]/g;
