import type { AppT } from "@/i18n/app";

import { readFacts } from "./activation-facts";
import type { WorkspacePack } from "./types";

/** The checks a first-run step can use (a closed list; each is answered by a real read, activation-facts.ts). */
export type StepCheck = "business_profile" | "institution_set" | "second_factor_set" | "catalogue_has_items" | "quote_rules_set" | "delivery_rule_set" | "students_imported" | "fee_plan_set" | "whatsapp_connected" | "first_quote_sent" | "first_campaign_approved" | "lead_source_added" | "call_rule_approved" | "ask_assistant_tried";
export type StepState = "done" | "todo" | "unavailable";
export type StartStep = { id: string; check: StepCheck; title: string; hint: string; state: StepState; href: string | null };
export type Activation = { steps: StartStep[]; done: number; total: number; next: StartStep | null };

/** The Lead Desk steps a workspace is offered (night 4): only for a business type with a Lead Desk template, and each only while its part of the product is switched on (lib/packs/lead-activation.ts decides). */
export type LeadDeskStep = Extract<StepCheck, "lead_source_added" | "call_rule_approved" | "ask_assistant_tried">;

/**
 * Where a step goes, relative to the workspace (`/app/tenants/<id>` + this). A step with no screen yet is `unavailable` and has none. The checks are a closed list; each is answered by a REAL fact read from the backend
 * (activation-facts.ts), never a flag a person ticks: a fact that cannot be read is `todo` (never "done"), and a check whose screen is not built yet says "Not available yet".
 */
const WHERE: Record<StepCheck, string | null> = {
  business_profile: "/start",
  second_factor_set: "/app/security", // an account page: a path that starts with /app is used as it is
  institution_set: "/programmes",
  catalogue_has_items: "/catalogue/new",
  quote_rules_set: "/quote-policy",
  whatsapp_connected: "/integrations/whatsapp",
  first_quote_sent: "/quotes",
  delivery_rule_set: "/quote-policy",
  students_imported: "/students/import",
  fee_plan_set: "/fees/plans",
  first_campaign_approved: "/campaigns",
  lead_source_added: "/lead-sources", // night 4, Lead Desk: a source is connected, or leads were brought in
  call_rule_approved: "/outreach",
  ask_assistant_tried: "/tasks",
};

/**
 * The first-run steps of a workspace, from the MODULES it has on (blueprint 3.3), never from a business type's name: the business name and city; products (a catalogue) or people (programmes); the rule that
 * makes its money work (delivery, quote rules or fee plan, in that order of what it has); the second step (an authenticator code); WhatsApp (an inbox); and the first real use (a quote, else a reminder campaign). Textiles, construction and education each
 * come out as the table in the blueprint because of the modules they have; a new business type gets its steps the same way.
 */
export function stepChecks(modules: readonly string[], leadDesk: readonly LeadDeskStep[] = []): StepCheck[] {
  const has = (m: string) => modules.includes(m);
  const steps: StepCheck[] = ["business_profile"];
  if (has("catalogue")) steps.push("catalogue_has_items");
  else if (has("programmes")) steps.push("institution_set", "students_imported");
  if (has("deliveries")) steps.push("delivery_rule_set");
  else if (has("quotes")) steps.push("quote_rules_set");
  else if (has("fees")) steps.push("fee_plan_set");
  // the second factor is not asked at sign-up: it is asked before the first real use (approvals) and before WhatsApp is connected (ADR 0016, blueprint 3.1), so it comes just before them
  if (has("inbox") || has("quotes") || has("campaigns")) steps.push("second_factor_set");
  if (has("inbox")) steps.push("whatsapp_connected");
  if (has("quotes")) steps.push("first_quote_sent");
  // a fee-reminder campaign is the first real use only where fees are a module (a school); the other businesses with campaigns have Lead Desk steps instead
  else if (has("fees") && has("campaigns")) steps.push("first_campaign_approved");
  steps.push(...leadDesk);
  return steps;
}

/**
 * Does this workspace use the checklist? A workspace that existed before business types, or was made without choosing one (`default`, `legacy`), keeps the first-run wizard it has always had; one made at sign-up
 * with a chosen business type (or moved by the operator) gets the checklist.
 */
export function usesChecklist(pack: Pick<WorkspacePack, "source"> | null): boolean {
  return pack !== null && (pack.source === "signup" || pack.source === "operator");
}

export async function readActivation(accessToken: string, tenantId: string, pack: Pick<WorkspacePack, "modules">, t: AppT, leadDesk: readonly LeadDeskStep[] = []): Promise<Activation> {
  const checks = stepChecks(pack.modules, leadDesk);
  const facts = await readFacts(accessToken, tenantId, checks);
  const steps: StartStep[] = checks.map((check) => {
    const where = WHERE[check];
    const state: StepState = where === null ? "unavailable" : facts[check] ? "done" : "todo";
    return { id: check, check, title: t(`start.check.${check}.title` as "start.title"), hint: t(`start.check.${check}.hint` as "start.title"), state, href: where };
  });
  return { steps, done: steps.filter((s) => s.state === "done").length, total: steps.length, next: steps.find((s) => s.state === "todo") ?? null };
}
