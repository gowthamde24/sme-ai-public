import { ApiAuthError } from "@/lib/api/client";
import { fetchQuotes } from "@/lib/api/quotes";
import { listVisits } from "@/lib/api/visits";
import { readReport } from "@/lib/outreach/source";
import type { OutreachReport } from "@/lib/outreach/types";
import { visitFigures } from "@/lib/report/week";
import { calledCount, quoteFigures, sourceResults, type DayRange, type SourceResult, type StageCounts } from "@/lib/reports-v6/results";
import { outreachScreens } from "@/lib/screens/flag";

/**
 * The reads of the design-system-v6 Reports page, each on its own with the person's own token (a part that fails says "not available yet" for its steps; a rejected session is thrown): the lead report of Lead Desk (enquiries, calls answered, visits
 * booked and what a visit cost, per source), the visits of the range (booked, and those that ended in a purchase = won) and the quotes made in it. SERVER ONLY.
 */
export type ResultsRead = { counts: StageCounts; quotesPaise: number | null; sources: SourceResult[]; costPerVisitPaise: number | null; mock: boolean };

async function settle<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function readResultsV6(ctx: { token: string; tenantId: string; userId: string }, range: Pick<DayRange, "from" | "to">): Promise<ResultsRead> {
  const [report, visits, quotes] = await Promise.all([
    outreachScreens() === "off" ? Promise.resolve<OutreachReport | null>(null) : readReport(ctx, range.from, range.to),
    settle(async () => visitFigures((await listVisits(ctx.token, ctx.tenantId, { from: range.from, to: range.to })).items, range)),
    settle(() => fetchQuotes(ctx.token, ctx.tenantId, 50)),
  ]);
  const q = quotes === null ? null : quoteFigures(quotes, range);
  const counts: StageCounts = {
    enquiries: report ? report.total.leads : null,
    called: report ? calledCount(report.total) : null,
    // the visits the assistant booked from the lead report when the visit list could not be read
    visits: visits ? visits.booked : report ? report.total.bookings : null,
    quotes: q ? q.count : null,
    won: visits ? visits.bought : null,
  };
  return { counts, quotesPaise: q ? q.paise : null, sources: report ? sourceResults(report.bySource) : [], costPerVisitPaise: report ? report.total.costPerBookingPaise : null, mock: outreachScreens() === "mock" };
}
