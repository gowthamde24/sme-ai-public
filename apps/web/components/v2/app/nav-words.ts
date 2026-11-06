import { word, type Labels } from "./labels";
import { FOOT, NAV, type NavItem, type PackFrame } from "./nav";

/**
 * The menu's words, shared by the menu (client) and the pages (server): a page's H1 is its menu row's word, exactly as the menu shows it (owner rule, 6 Nov 2026: standard navigation). Pure: no React, no request.
 */
/** The app's English word of each page (the menu table's), for a frame drawn without its words (a test). */
export const PAGE_WORDS: Readonly<Record<string, string>> = Object.fromEntries([...NAV.flatMap((g) => g.items), ...FOOT].map((p) => [`nav.item.${p.id}`, p.label]));

/** The business type's words that are its OWN: those that differ from the app's word for the same key (a pack that calls its catalogue "Catalogue" has no word of its own for it). */
export function ownWords(pack: PackFrame | null | undefined, plain: Labels | undefined): Readonly<Record<string, string>> {
  if (!pack) return {};
  return Object.fromEntries(Object.entries(pack.labels).filter(([k, v]) => v !== (plain?.[k] ?? PAGE_WORDS[k])));
}

/** A row's word: the business type's own word for its page when it has one ("Campus visits", "Materials"), else the row's word ("Catalogue & stock"). */
export function rowWord(item: NavItem & { labelOf?: string }, labels: Labels | undefined, own: Readonly<Record<string, string>> | undefined): string {
  const mine = item.labelOf ? own?.[`nav.item.${item.labelOf}`] : undefined;
  return mine ?? word(labels, `nav.item.${item.id}`, item.label);
}

