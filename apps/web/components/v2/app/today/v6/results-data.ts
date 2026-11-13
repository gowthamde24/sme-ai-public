import { formatRupeesShort } from "@/lib/money";
import { STAGES, barWidths, costResults, noResults, type SourceResult, type StageCounts, type StageId } from "@/lib/reports-v6/results";

/**
 * "This week's results" (design system v6, the final Today), the data: the funnel (enquiries, called, visits booked, quotes sent, sales) and what a visit cost by source, from the same reads as the Reports page (`readResultsV6`). Pure. A step that could not be read is left out;
 * with no step above zero and no source that brought a visit, there is nothing to draw (the card says so).
 */
export type ResultsStage = { id: StageId; value: number; width: number };
export type SourceCost = { name: string; amountText: string; width: number };
export type ResultsView = { stages: ResultsStage[]; costs: SourceCost[] };

export function resultsView(counts: StageCounts, sources: readonly SourceResult[], nameOf: (source: string) => string): ResultsView {
  if (noResults(counts, sources)) return { stages: [], costs: [] };
  const widths = barWidths(STAGES.map((id) => counts[id]));
  const stages = STAGES.flatMap((id, i) => (counts[id] === null ? [] : [{ id, value: counts[id] as number, width: widths[i] }]));
  const costs = costResults(sources).slice(0, 4);
  const max = Math.max(0, ...costs.map((c) => c.paise));
  return { stages, costs: costs.map((c) => ({ name: nameOf(c.source), amountText: formatRupeesShort(c.paise), width: max > 0 ? Math.max(4, Math.round((c.paise / max) * 100)) : 0 })) };
}
