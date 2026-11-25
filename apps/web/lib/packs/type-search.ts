/**
 * The search of the business-type tiles (owner, 26 Nov 2026: "a search box instead of hunting through 54 tiles"). One pure function for every place the tiles are drawn. A typed word matches a tile when it starts a word of the type's name, its one line or its
 * synonyms (the catalogue's keywords, `packages/packs/categories.json`, and the type's name in every language, so a Telugu name finds it too); every typed word must match. Matches come first, best first (name 3, synonyms 2, line 1 per word), the rest after in the list's own order.
 */
export type TypeRow = { id: string; name: string; line: string; /** synonyms and the name in other languages, one space-separated string */ keywords?: string };

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const split = (s: string): string[] => (s.toLowerCase().match(WORD) ?? []);

/** The words of a search: letters and digits of any script; one letter alone is too little to search by. */
export const searchWords = (query: string): string[] => split(query).filter((w) => w.length >= 2);

function score(words: readonly string[], row: TypeRow): number {
  const name = split(row.name);
  const kw = split(row.keywords ?? "");
  const line = split(row.line);
  let total = 0;
  for (const w of words) {
    const by = (list: readonly string[]) => list.some((x) => x.startsWith(w));
    const s = (by(name) ? 3 : 0) + (by(kw) ? 2 : 0) + (by(line) ? 1 : 0);
    if (s === 0) return 0; // every typed word has to match something
    total += s;
  }
  return total;
}

export type TypeSearchResult = { matches: TypeRow[]; rest: TypeRow[]; searching: boolean };
export function searchTypes(rows: readonly TypeRow[], query: string): TypeSearchResult {
  const words = searchWords(query);
  if (words.length === 0) return { matches: [...rows], rest: [], searching: false };
  const scored = rows.map((r, i) => ({ r, i, s: score(words, r) }));
  const matches = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
  return { matches, rest: scored.filter((x) => x.s === 0).map((x) => x.r), searching: true };
}

/** The synonyms of a type for the search: its catalogue keywords and its name in every language. */
export const typeKeywords = (p: { names: Readonly<Record<string, string>>; keywords?: string }): string => [p.keywords ?? "", ...Object.values(p.names)].join(" ").trim();

/** More than this many tiles is a long list: the rest of a search sits behind "Show all types". */
export const LONG_LIST = 12;
