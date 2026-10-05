import type { ClaimSuggestionOut } from "@/lib/api/agents";

export type ClaimGroup = {
  key: string;
  company: string;
  predicate: string;
  /** The suggestions that are still in play for this predicate: unreviewed or accepted (a rejected one is out). */
  claims: ClaimSuggestionOut[];
  /** Two or more of them say different things: shown side by side. */
  conflicting: boolean;
};

/**
 * One group per (company, predicate) that has at least one UNREVIEWED agent suggestion. A group lists every suggestion
 * still in play for it, so a reviewer who is about to accept one sees what else was proposed, or already accepted, for
 * the same thing. Newest group first.
 */
export function groupClaims(claims: ClaimSuggestionOut[]): ClaimGroup[] {
  const groups = new Map<string, ClaimSuggestionOut[]>();
  for (const claim of claims) {
    if (claim.created_via !== "agent") continue;
    const home = claim.company_id ?? claim.lead_id ?? "unknown";
    const key = `${home}|${claim.predicate}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const out: ClaimGroup[] = [];
  for (const [key, all] of groups) {
    if (!all.some((c) => c.review_state === "unreviewed")) continue;
    const inPlay = all.filter((c) => c.review_state === "unreviewed" || c.review_state === "accepted");
    out.push({
      key,
      company: all.find((c) => c.company_name)?.company_name ?? "Unnamed company",
      predicate: all[0].predicate,
      claims: inPlay,
      conflicting: new Set(inPlay.map((c) => c.value)).size > 1,
    });
  }
  const newest = (g: ClaimGroup) => Math.max(...g.claims.map((c) => Date.parse(c.created_at)));
  return out.sort((a, b) => newest(b) - newest(a));
}
