import type { ReactNode } from "react";

import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { ReportsV6 } from "@/components/v2/app/report-v6/ReportsV6";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { clock } from "@/lib/clock";
import { sourceNames } from "@/lib/outreach/words";
import { periodOf } from "@/lib/reports-v6/period";
import { outreachScreens } from "@/lib/screens/flag";

import { readSeriesV6 } from "./series-data";
import { readResultsV6 } from "./v6-data";

type Query = Record<string, string | string[] | undefined>;

/**
 * Reports of design system v6 (DESIGN_V6, the approved mock): `?range=today|month|custom&from=&to=` (the last 14 days by default). The funnel and the sources come from the lead report, the visits and the quotes (readResultsV6); the day-by-day lines, the cost of the assistant and
 * the busiest times from the leads, visits, orders and calls (readSeriesV6). Each read is its own: one that fails leaves "Not available yet" in its place. `more` is the business type's own report list, drawn under the page.
 */
export async function ReportsV6Page({ token, userId, tenantId, businessName, query, more = null, now = clock() }: { token: string; userId: string; tenantId: string; businessName: string; query: Query; more?: ReactNode; now?: number }) {
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const period = periodOf(query, now);
  const words = wordsFor(lang, ["rv6.", "ld.source.", "nav.item.leadreport", "nav.item.everything"]);
  const [data, series] = await Promise.all([readResultsV6({ token, tenantId, userId }, period), readSeriesV6({ token, tenantId }, period)]);
  return (
    <ReportsV6
      words={words}
      lang={lang}
      base={base}
      help={helpTipFor(lang, base, "reports", true)}
      businessName={businessName}
      period={period}
      counts={data.counts}
      series={series}
      today={todayInIndia(now)}
      sources={data.sources}
      sourceNames={sourceNames(words)}
      startHref={`${base}/${outreachScreens() === "off" ? "lead-desk" : "outreach"}`}
      more={more}
      mock={data.mock}
    />
  );
}
