/**
 * "Describe what you sell" (owner, 29 Nov 2026): a few words in any language pick the closest business type. Pure and small: the words a person types are compared with each type's name, its one line and its search words
 * (data from the API's groups file); the best score wins, and nothing is guessed below a floor. No business type is named here.
 */
export type MatchOption = { readonly id: string; readonly name: string; readonly tagline: string; readonly keywords?: string };

const STOP = new Set(["the", "and", "for", "with", "our", "we", "sell", "selling", "shop", "business", "services", "service", "have", "that", "are", "you", "your", "from", "this", "also", "all", "any", "other"]);
export const words = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));

/** Score of one option for the typed words: a search word equal +3, one that starts the same (4 letters or more) +2, a word of the name +2, of the line +1. */
export function score(typed: readonly string[], o: MatchOption): number {
  const kw = words(o.keywords ?? "");
  const nm = words(o.name);
  const tg = words(o.tagline);
  let s = 0;
  for (const w of typed) {
    if (kw.includes(w)) s += 3;
    else if (w.length >= 4 && kw.some((k) => k.length >= 4 && (k.startsWith(w) || w.startsWith(k)))) s += 2;
    if (nm.includes(w)) s += 2;
    if (tg.includes(w)) s += 1;
  }
  return s;
}

/** The closest option and its score, or null when no word matched (a score under 2 is not a match). Ties keep the list's order. */
export function closest(text: string, options: readonly MatchOption[]): MatchOption | null {
  const typed = [...new Set(words(text))];
  if (typed.length === 0) return null;
  let best: MatchOption | null = null;
  let top = 1;
  for (const o of options) {
    const s = score(typed, o);
    if (s > top) {
      top = s;
      best = o;
    }
  }
  return best;
}
