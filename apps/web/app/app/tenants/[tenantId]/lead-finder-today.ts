import type { NeedsCard, Role, T } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getProspectStats, listProspects } from "@/lib/api/lead-finder";
import { reasonKey, reasonLine, type FinderAccess, type Prospect } from "@/lib/lead-finder/types";

/**
 * What the Lead Finder adds to Today's "Needs you" (job lead-finder part D, contract section 3): the new businesses the Researcher left for a person (`needs_owner`), each ONE short row like the others ("Sri Sai Constructions · fit 64 · low
 * stock"), best fit first, at most `MAX_ROWS`; when more wait, one more row says how many and opens the tab filtered to them. A row opens the Prospects tab on that one business. Only where the Lead Finder is available, and only for
 * the people who act on prospects (Owner, Admin, Sales). The rows join Today's through `mergeDesk` (today-data.ts), which counts each new card once. A part that cannot be read adds nothing; a rejected session is thrown. SERVER ONLY.
 */
export const MAX_ROWS = 5;

/** A prospect's short row line (owner, 5 Nov: "area · rating · fit"): "Jayanagar · 4.6★ · fit 93", then the decision in a few words unless it is the first-calls rule (that one is the "Needs OK" badge). */
export function rowLineOf(p: Pick<Prospect, "area" | "rating" | "fitScore" | "decisionReason">, t: T): string {
  const why = p.decisionReason === "first_calls" ? null : reasonKey(p.decisionReason);
  const parts = [p.area, p.rating !== null ? `${p.rating.toLocaleString("en-IN", { maximumFractionDigits: 1 })}★` : null, p.fitScore !== null ? t("lf.fit", { n: p.fitScore }) : null, why ? t(why) : null];
  return parts.filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" · ");
}

export function finderCards(rows: readonly Prospect[], waiting: number, base: string, t: T): NeedsCard[] {
  const shown = rows.filter((p) => p.status === "needs_owner").slice(0, MAX_ROWS);
  const cards: NeedsCard[] = shown.map((p) => ({
    type: "item",
    key: `prospect_waiting-${p.id}`,
    at: p.updatedAt,
    item: {
      kind: "prospect_waiting",
      id: p.id,
      customer: p.name ?? t("lf.details.unavailable"),
      city: null,
      agent: "lead_finder",
      // the row says where and how good (owner, 5 Nov: "Jayanagar · 4.6★ · fit 93"); "1 of the first 10 calls" is the small "Needs OK" badge; any other reason keeps its few words; the opened card keeps the whole line with the fit
      summary: reasonLine(p, (k, v) => t(k, v)),
      rowLine: rowLineOf(p, t),
      prospect: { area: p.area, rating: p.rating, needsOk: p.decisionReason === "first_calls" },
      at: p.updatedAt,
      amount_paise: null,
      href: `${base}/retailers?${new URLSearchParams({ id: p.id })}`,
    },
  }));
  const more = waiting - shown.length;
  if (more > 0 && shown.length > 0) {
    const at = shown[shown.length - 1].updatedAt;
    cards.push({ type: "item", key: "prospect_waiting-more", at, item: { kind: "prospect_waiting", id: "more", customer: t("today.prospect.more", { n: more }), city: null, agent: "lead_finder", summary: t("today.prospect.more.sum"), at, amount_paise: null, href: `${base}/retailers?status=needs_owner`, count: more } });
  }
  return cards;
}

/**
 * Plan tiers (owner decision 4 Nov): a Lead Desk workspace has no Lead Finder, so instead of its rows Today shows ONE short row, "Find new retailers near you · part of AI Workforce", that opens Settings -> Plan. Only for the Owner and Admin
 * (the people who see the plans; Sales and a Viewer get nothing: they cannot change it). `href`: lib/plan/tier-source.ts `upgradeHref`. The caller adds it after the count of what waits: it is not something that waits.
 */
export function finderUpsellCard(role: Role, href: string | null, t: T, at: string): NeedsCard | null {
  if ((role !== "owner" && role !== "admin") || href === null) return null;
  return { type: "item", key: "plan_upsell-lead_finder", at, item: { kind: "plan_upsell", id: "lead_finder", customer: t("today.upsell.title"), city: null, agent: "lead_finder", summary: t("today.upsell.sum"), at, amount_paise: null, href } };
}

const settled = <V>(r: PromiseSettledResult<V>): V | null => {
  if (r.status === "fulfilled") return r.value;
  if (r.reason instanceof ApiAuthError) throw r.reason;
  return null;
};

/** Reads the businesses that need a person (the first page, best fit first) and how many there are. `access` is the frame's answer (`readFinderAccessCached`): anything but `on` = nothing is read. */
export async function readFinderNeeds(ctx: { token: string; tenantId: string }, role: Role, access: FinderAccess | null, base: string, t: T): Promise<NeedsCard[]> {
  if (role === "viewer" || access !== "on") return [];
  const [page, stats] = await Promise.allSettled([listProspects(ctx.token, ctx.tenantId, { status: "needs_owner", limit: MAX_ROWS }), getProspectStats(ctx.token, ctx.tenantId)]);
  const rows = settled(page);
  if (!rows) return [];
  const counted = settled(stats)?.byStatus.needs_owner;
  return finderCards(rows.items, counted ?? rows.items.length, base, t);
}
