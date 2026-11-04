import { PROVIDERS, SEARCH_STATES, searchRank, type LeadFinderCard, type Search } from "@/lib/lead-finder/types";

/**
 * The Lead Finder's cards in the chat (docs/contracts/lead-finder.md section 1b). The server reads the API's card with the SearchOut reader (lib/api/lead-finder-card.ts) and hands it on in its own shape; the browser checks that shape
 * again here before drawing it (the stream is this app's own, but nothing in it is guessed). And ONE card per search: a search's card stays on the reply that first showed it (as the history has it), showing the furthest state any
 * later event, a replay or the card's own OK has brought.
 */
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (v: unknown, max: number): boolean => typeof v === "string" && v.length <= max;
const shortOrNull = (v: unknown, max: number): boolean => v === null || short(v, max);
const whole = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const wholeOrNull = (v: unknown): boolean => v === null || whole(v);

export function isFinderSearch(v: unknown): v is Search {
  if (!isRec(v)) return false;
  const counts = v.counts;
  return (
    typeof v.id === "string" &&
    UUID.test(v.id) &&
    (SEARCH_STATES as readonly unknown[]).includes(v.state) &&
    (PROVIDERS as readonly unknown[]).includes(v.provider) &&
    short(v.query, 300) &&
    shortOrNull(v.area, 300) &&
    whole(v.maxResults) &&
    whole(v.estCostPaise) &&
    whole(v.costPaise) &&
    typeof v.costIsEstimate === "boolean" &&
    short(v.sourceLabel, 300) &&
    whole(v.found) &&
    wholeOrNull(v.searchesLeftToday) &&
    shortOrNull(v.attribution, 60) &&
    (counts === null || (isRec(counts) && Object.values(counts).every(whole)))
  );
}

export const isFinderCard = (v: unknown): v is LeadFinderCard => isRec(v) && typeof v.canApprove === "boolean" && isFinderSearch(v.search);

/**
 * For each exchange of the thread (oldest first), the card it draws, or null. The first exchange that carried a search's card draws it; a later one that carries the same search (the "yes" turn, a replay) draws nothing more. The card
 * shows the furthest state seen for that search, in the thread or in `own` (what the card's own OK or Cancel answered); between equals the latest wins.
 */
export function finderCards(cards: readonly (LeadFinderCard | null | undefined)[], own: Readonly<Record<string, Search>> = {}): (LeadFinderCard | null)[] {
  const best = new Map<string, LeadFinderCard>();
  for (const c of cards) {
    if (!c) continue;
    const was = best.get(c.search.id);
    if (!was || searchRank(c.search.state) >= searchRank(was.search.state)) best.set(c.search.id, c);
  }
  for (const [id, search] of Object.entries(own)) {
    const was = best.get(id);
    if (was && searchRank(search.state) >= searchRank(was.search.state)) best.set(id, { ...was, search });
  }
  const drawn = new Set<string>();
  return cards.map((c) => {
    if (!c || drawn.has(c.search.id)) return null;
    drawn.add(c.search.id);
    return best.get(c.search.id) ?? c;
  });
}
