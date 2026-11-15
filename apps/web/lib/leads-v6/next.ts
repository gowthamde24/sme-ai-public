import type { LeadRow } from "./rows";

/**
 * The lead to look at first when none is picked (product audit, Leads: the empty right panel used to say "Pick a lead" all day). A lead of the table, not a found business; open ones only (not won, not lost). Ready to buy first, then new ones nobody has contacted, then the rest; inside each, the newest. `why` is a closed word the screen turns into a sentence. Pure.
 */
export type NextLead = { row: LeadRow; why: "hot" | "new" | "waiting" };

export function bestNext(rows: readonly LeadRow[]): NextLead | null {
  let best: { row: LeadRow; rank: number; why: NextLead["why"] } | null = null;
  for (const row of rows) {
    if (row.kind !== "lead" || row.chip === "won" || row.chip === "lost") continue;
    const why: NextLead["why"] = row.hot ? "hot" : row.isNew ? "new" : "waiting";
    const rank = why === "hot" ? 2 : why === "new" ? 1 : 0;
    if (best === null || rank > best.rank || (rank === best.rank && row.at > best.row.at)) best = { row, rank, why };
  }
  return best ? { row: best.row, why: best.why } : null;
}
