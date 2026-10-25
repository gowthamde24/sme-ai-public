import type { PlanCatalogue, PlanDef } from "@/lib/plan/types";

/** What the home page's plan cards need from the translator: a word for a key and its {variables}. */
export type Say = (key: string, vars?: Record<string, string | number>) => string;

const num = (n: number): string => new Intl.NumberFormat("en-IN").format(n);

/**
 * The lines of one plan card on the home page (job DM), made from the plans DATA (packages/plans/plans.json, read through lib/plan/catalogue.ts): what each plan includes is whatever the data says, so the numbers can never differ
 * from the plan's own and no plan is named here. A main plan lists its team and businesses, minutes and business WhatsApp messages; a calls-only plan its minutes and its WhatsApp follow-up messages. 0 minutes is "AI calls as an
 * add-on"; no limit (null) is "pay for each". AI itself is "included, under fair use" and has no number. No price appears: `price` is never read.
 */
export function planLines(p: PlanDef, say: Say): string[] {
  const lines: string[] = [];
  if (p.kind === "main") lines.push(say("hm.pl.f.team", { users: p.users === null ? "—" : num(p.users), workspaces: p.workspaces === null ? "—" : num(p.workspaces) }));
  lines.push(p.callMinutes === null ? say("hm.pl.f.minutesPayg") : p.callMinutes === 0 ? say("hm.pl.f.minutes0") : say("hm.pl.f.minutes", { n: num(p.callMinutes) }));
  if (p.messages === null) lines.push(say("hm.pl.f.msgsPayg"));
  else if (p.messages > 0) lines.push(say(p.kind === "main" ? "hm.pl.f.msgs" : "hm.pl.f.follow", { n: num(p.messages) }));
  lines.push(say("hm.pl.f.ai"));
  return lines;
}

export type PlanGroup = { kind: PlanDef["kind"]; plans: { id: string; name: string; features: string[] }[] };

/** The plans of a catalogue as the two groups of the home page (the full workforce, AI calling only), in the catalogue's own order. */
export function planGroups(cat: PlanCatalogue, say: Say): PlanGroup[] {
  return (["main", "calls"] as const).map((kind) => ({ kind, plans: cat.plans.filter((p) => p.kind === kind).map((p) => ({ id: p.id, name: p.name, features: planLines(p, say) })) }));
}
