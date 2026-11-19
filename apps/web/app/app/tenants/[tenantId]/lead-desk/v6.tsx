import type { ReactNode } from "react";

import { early, Part, settle } from "@/components/v2/app/ds/Streamed";
import { InlineError } from "@/components/v2/app/ds/InlineError";
import { LeadsV6Body, LeadsV6Shell, type Touch } from "@/components/v2/app/leads/LeadsV6";
import { LeadsPlaceholder } from "@/components/v2/app/leads/LeadsPlaceholder";
import { makeT } from "@/components/v2/app/words";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { chipCounts, isLeadChip, type LeadChip } from "@/lib/leads-v6/chips";
import { fromSource, searchRows, sourcesOf } from "@/lib/leads-v6/rows";
import { readHandoffs } from "@/lib/outreach/source";
import { sourceNames } from "@/lib/outreach/words";
import { jobsScreens, outreachScreens } from "@/lib/screens/flag";

import type { LeadContext } from "../lead-context";
import { readLeadsV6, readTouches } from "./v6-data";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The Leads page of design system v6 (DESIGN_V6): the table with the six chips and the customer's panel. The address keeps the state: `?chip=`, `?q=`, `?open=` (a row), `?after=` (the next page of Lead Desk's leads).
 * The heading goes out at once (it needs no data: it is the first thing read); the leads, the chips and the panel are a part of their own that arrives when the leads are read, under a placeholder of the same size (staging, 19 Nov 2026: the line under
 * the title was the largest paint of the page and arrived with the table). A page that cannot read its leads says the one quiet sentence it always said.
 */
export async function LeadsV6Page({ ctx, query }: { ctx: LeadContext; query: Query }) {
  const { accessToken, userId, tenantId, tenant } = ctx;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const simple = jobsScreens() !== "off";
  const words = wordsFor(lang, ["lv6.", "ld.source.", "lf.v6.", ...(simple ? ["jobs.pg.leads."] : [])]);
  const rawChip = one(query.chip);
  const chip: LeadChip | "all" = isLeadChip(rawChip) ? rawChip : "all";
  const q = (one(query.q) ?? "").trim().slice(0, 80);
  const open = one(query.open) ?? "";
  const cursor = one(query.after);
  const after = typeof cursor === "string" && cursor.length > 0 && cursor.length <= 300 ? cursor : null;
  const lctx = { token: accessToken, tenantId, userId };
  // JOBS: "from [everywhere]" is `?source=` (a place the leads came from); it is read only under JOBS
  const rawSource = (one(query.source) ?? "").trim();
  const source = simple && /^[\w-]{1,40}$/.test(rawSource) ? rawSource : null;
  const href = (over: { chip?: LeadChip | "all"; open?: string | null; after?: string | null; source?: string | null }): string => {
    const p = new URLSearchParams();
    const c = over.chip ?? chip;
    if (c !== "all") p.set("chip", c);
    if (q) p.set("q", q);
    const src = over.source === undefined ? source : over.source;
    if (src) p.set("source", src);
    const o = over.open === undefined ? open : over.open;
    if (o) p.set("open", o);
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return `${base}/lead-desk${s ? `?${s}` : ""}`;
  };
  const canAdd = tenant.role !== "viewer";
  // the reads start now; the heading below does not wait for them
  const body = early(
    (async (): Promise<ReactNode> => {
      const handoffs = tenant.role !== "viewer" && outreachScreens() !== "off" ? await readHandoffs(lctx, true) : null;
      const read = await readLeadsV6(lctx, { handoffs, after, q, now: new Date(), newEnquiry: words["lv6.newenquiry"] ?? "New enquiry", unavailable: words["lv6.unavailable"] ?? "Details unavailable" });
      const searched = searchRows(read.rows, q);
      const placed = simple ? fromSource(searched, source) : searched;
      const counts = chipCounts(placed);
      const shown = chip === "all" ? placed : placed.filter((r) => r.chip === chip);
      const selected = placed.find((r) => r.key === open) ?? null;
      const touches: Touch[] | null = selected && selected.kind === "lead" ? ((await readTouches(lctx, selected.id))?.items ?? null) : null;
      return (
        <LeadsV6Body
          words={words}
          lang={lang}
          base={base}
          rows={shown}
          counts={counts}
          chip={chip}
          q={q}
          sourceNames={sourceNames(words)}
          selected={selected}
          touches={touches}
          chipHref={(c) => href({ chip: c, open: null })}
          rowHref={(r) => href({ open: r.key })}
          moreHref={read.nextCursor ? href({ after: read.nextCursor }) : null}
          canAdd={canAdd}
          unavailable={read.unavailable}
          mock={read.mock}
          simple={
            simple
              ? {
                  source,
                  sources: [...sourcesOf(searched), ...(source && !sourcesOf(searched).includes(source) ? [source] : [])].map((key) => ({ key, label: key === "finder" ? (words["lv6.finder"] ?? key) : key === "none" ? (words["lv6.nosource"] ?? key) : (sourceNames(words)[key] ?? key.replace(/_/g, " ")) })),
                  sourceHref: (s) => href({ source: s, open: null }),
                }
              : undefined
          }
        />
      );
    })(),
  );
  const t = makeT(words);
  return (
    <LeadsV6Shell words={words} lang={lang} base={base} help={helpTipFor(lang, base, "leads", true)} canAdd={canAdd}>
      <Part of={settle(body)} fallback={<LeadsPlaceholder />} quiet={<InlineError text={t("lv6.na")} retry={t("lv6.retry")} />} />
    </LeadsV6Shell>
  );
}
