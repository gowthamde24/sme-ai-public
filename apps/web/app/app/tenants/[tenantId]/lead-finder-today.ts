import type { NeedsCard, Role, T } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getProspectStats, listProspects } from "@/lib/api/lead-finder";
import { reasonLine, type Availability, type Prospect } from "@/lib/lead-finder/types";

/**
 * What the Lead Finder adds to Today's "Needs you" (job lead-finder part D, contract section 3): the new businesses the Researcher left for a person (`needs_owner`), each ONE short row like the others ("Sri Sai Constructions · fit 64 · low
 * stock"), best fit first, at most `MAX_ROWS`; when more wait, one more row says how many and opens the tab filtered to them. A row opens the Prospects tab on that one business. Only where the Lead Finder is available, and only for
 * the people who act on prospects (Owner, Admin, Sales). The rows join Today's through `mergeDesk` (today-data.ts), which counts each new card once. A part that cannot be read adds nothing; a rejected session is thrown. SERVER ONLY.
 */
export const MAX_ROWS = 5;

export function finderCards(rows: readonly Prospect[], waiting: number, base: string, t: T): NeedsCard[] {
  const shown = rows.filter((p) => p.status === "needs_owner").slice(0, MAX_ROWS);
  const cards: NeedsCard[] = shown.map((p) => ({
    type: "item",
    key: `prospect_waiting-${p.id}`,
    at: p.updatedAt,
    item: { kind: "prospect_waiting", id: p.id, customer: p.name, city: null, agent: "lead_finder", summary: reasonLine(p, (k, v) => t(k, v)), at: p.updatedAt, amount_paise: null, href: `${base}/retailers?${new URLSearchParams({ id: p.id })}` },
  }));
  const more = waiting - shown.length;
  if (more > 0 && shown.length > 0) {
    const at = shown[shown.length - 1].updatedAt;
    cards.push({ type: "item", key: "prospect_waiting-more", at, item: { kind: "prospect_waiting", id: "more", customer: t("today.prospect.more", { n: more }), city: null, agent: "lead_finder", summary: t("today.prospect.more.sum"), at, amount_paise: null, href: `${base}/retailers?status=needs_owner` } });
  }
  return cards;
}

const settled = <V>(r: PromiseSettledResult<V>): V | null => {
  if (r.status === "fulfilled") return r.value;
  if (r.reason instanceof ApiAuthError) throw r.reason;
  return null;
};

/** Reads the businesses that need a person (the first page, best fit first) and how many there are. `availability` is the frame's answer (`readFinderCached`): null or not available = nothing. */
export async function readFinderNeeds(ctx: { token: string; tenantId: string }, role: Role, availability: Availability | null, base: string, t: T): Promise<NeedsCard[]> {
  if (role === "viewer" || !availability?.available) return [];
  const [page, stats] = await Promise.allSettled([listProspects(ctx.token, ctx.tenantId, { status: "needs_owner", limit: MAX_ROWS }), getProspectStats(ctx.token, ctx.tenantId)]);
  const rows = settled(page);
  if (!rows) return [];
  const counted = settled(stats)?.byStatus.needs_owner;
  return finderCards(rows.items, counted ?? rows.items.length, base, t);
}
