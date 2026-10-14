import { readFacts } from "./activation-facts";
import { textIn } from "./registry";
import type { PackDef, StepCheck } from "./types";

export type StepState = "done" | "todo" | "unavailable";
export type StartStep = { id: string; check: StepCheck; title: string; hint: string; state: StepState; href: string | null };
export type Activation = { steps: StartStep[]; done: number; total: number; next: StartStep | null };

/**
 * Where a step goes, relative to the workspace (`/app/tenants/<id>` + this). A step with no screen yet is `unavailable` and has none. The checks are a closed list in the schema; each is answered by a REAL fact read
 * from the backend (activation-facts.ts), never a flag a person ticks: a fact that cannot be read is `todo` (never "done"), and a check whose screen is not built yet says "Not available yet".
 */
const WHERE: Record<StepCheck, string | null> = {
  business_profile: "/start",
  catalogue_has_items: "/catalogue/new",
  quote_rules_set: "/quote-policy",
  whatsapp_connected: "/integrations/whatsapp",
  first_quote_sent: "/quotes",
  delivery_rule_set: null,
  students_imported: null,
  fee_plan_set: null,
  first_campaign_approved: null,
};

export async function readActivation(accessToken: string, tenantId: string, def: PackDef, lang: string): Promise<Activation> {
  const facts = await readFacts(accessToken, tenantId, def.activation.steps.map((s) => s.check));
  const steps: StartStep[] = def.activation.steps.map((s) => {
    const where = WHERE[s.check];
    const state: StepState = where === null ? "unavailable" : facts[s.check] ? "done" : "todo";
    return { id: s.id, check: s.check, title: textIn(s.title, lang), hint: textIn(s.hint, lang), state, href: where };
  });
  return { steps, done: steps.filter((s) => s.state === "done").length, total: steps.length, next: steps.find((s) => s.state === "todo") ?? null };
}
