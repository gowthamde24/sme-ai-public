import { LeadsV6, type Touch } from "@/components/v2/app/leads/LeadsV6";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { chipCounts, isLeadChip, type LeadChip } from "@/lib/leads-v6/chips";
import { searchRows } from "@/lib/leads-v6/rows";
import { readHandoffs } from "@/lib/outreach/source";
import { sourceNames } from "@/lib/outreach/words";
import { outreachScreens } from "@/lib/screens/flag";

import type { LeadContext } from "../lead-context";
import { readLeadsV6, readTouches } from "./v6-data";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The Leads page of design system v6 (DESIGN_V6): the table with the six chips and the customer's panel. The address keeps the state: `?chip=`, `?q=`, `?open=` (a row), `?after=` (the next page of Lead Desk's leads). */
export async function LeadsV6Page({ ctx, query }: { ctx: LeadContext; query: Query }) {
  const { accessToken, userId, tenantId, tenant } = ctx;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const words = wordsFor(lang, ["lv6.", "ld.source."]);
  const rawChip = one(query.chip);
  const chip: LeadChip | "all" = isLeadChip(rawChip) ? rawChip : "all";
  const q = (one(query.q) ?? "").trim().slice(0, 80);
  const open = one(query.open) ?? "";
  const cursor = one(query.after);
  const after = typeof cursor === "string" && cursor.length > 0 && cursor.length <= 300 ? cursor : null;
  const lctx = { token: accessToken, tenantId, userId };
  const handoffs = tenant.role !== "viewer" && outreachScreens() !== "off" ? await readHandoffs(lctx, true) : null;
  const read = await readLeadsV6(lctx, { handoffs, after, q, now: new Date(), newEnquiry: words["lv6.newenquiry"] ?? "New enquiry", unavailable: words["lv6.unavailable"] ?? "Details unavailable" });
  const searched = searchRows(read.rows, q);
  const counts = chipCounts(searched);
  const shown = chip === "all" ? searched : searched.filter((r) => r.chip === chip);
  const selected = searched.find((r) => r.key === open) ?? null;
  const touches: Touch[] | null = selected && selected.kind === "lead" ? ((await readTouches(lctx, selected.id))?.items ?? null) : null;
  const href = (over: { chip?: LeadChip | "all"; open?: string | null; after?: string | null }): string => {
    const p = new URLSearchParams();
    const c = over.chip ?? chip;
    if (c !== "all") p.set("chip", c);
    if (q) p.set("q", q);
    const o = over.open === undefined ? open : over.open;
    if (o) p.set("open", o);
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return `${base}/lead-desk${s ? `?${s}` : ""}`;
  };
  return (
    <LeadsV6
      words={words}
      lang={lang}
      base={base}
      help={helpTipFor(lang, base, "leads", true)}
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
      canAdd={tenant.role !== "viewer"}
      unavailable={read.unavailable}
      mock={read.mock}
    />
  );
}
