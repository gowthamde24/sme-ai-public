import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { ReportsV6 } from "@/components/v2/app/report-v6/ReportsV6";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { clock } from "@/lib/clock";
import { sourceNames } from "@/lib/outreach/words";
import { isRangeKey, rangeOf, type RangeKey } from "@/lib/reports-v6/results";
import { outreachScreens } from "@/lib/screens/flag";

import { readResultsV6 } from "./v6-data";
import type { ReactNode } from "react";

type Query = Record<string, string | string[] | undefined>;

/** Reports of design system v6 (DESIGN_V6): results first. `?range=week|7|30` (this week by default). `more` is the business type's own report list, drawn under the three sections. */
export async function ReportsV6Page({ token, userId, tenantId, query, more = null, now = clock() }: { token: string; userId: string; tenantId: string; query: Query; more?: ReactNode; now?: number }) {
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const raw = Array.isArray(query.range) ? query.range[0] : query.range;
  const key: RangeKey = isRangeKey(raw) ? raw : "week";
  const range = rangeOf(key, now);
  const words = wordsFor(lang, ["rv6.", "ld.source."]);
  const data = await readResultsV6({ token, tenantId, userId }, range);
  return (
    <ReportsV6
      words={words}
      lang={lang}
      base={base}
      help={helpTipFor(lang, base, "reports", true)}
      range={key}
      rangeHref={(k) => `${base}/report${k === "week" ? "" : `?range=${k}`}`}
      counts={data.counts}
      quotesPaise={data.quotesPaise}
      sources={data.sources}
      costPerVisitPaise={data.costPerVisitPaise}
      sourceNames={sourceNames(words)}
      startHref={`${base}/${outreachScreens() === "off" ? "lead-desk" : "outreach"}`}
      more={more}
      mock={data.mock}
    />
  );
}
