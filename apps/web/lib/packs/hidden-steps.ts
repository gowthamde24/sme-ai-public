import { cookies } from "next/headers";

import type { Activation, StartStep, StepCheck } from "./activation";

/**
 * The "Finish setting up" steps a person has put away from Today (first-run fixes: skippable, dismissible per item). A convenience of their browser, one small cookie per workspace holding the step ids; it hides a step from Today
 * and nothing else (the step is still in Settings, where it can be shown again, and a done step stays done). Only ids of the closed list count; anything else in the cookie is dropped.
 */
export const STEP_IDS: readonly StepCheck[] = ["business_profile", "institution_set", "second_factor_set", "catalogue_has_items", "quote_rules_set", "delivery_rule_set", "students_imported", "fee_plan_set", "whatsapp_connected", "first_quote_sent", "first_campaign_approved", "lead_source_added", "call_rule_approved", "ask_assistant_tried"];

/** The cookie of one workspace (the first eight letters of its id are enough to keep them apart in one browser). */
export const hiddenStepsCookie = (tenantId: string): string => `s19_steps_off_${tenantId.replace(/-/g, "").slice(0, 8)}`;

export function parseHidden(value: string | undefined | null): StepCheck[] {
  if (!value) return [];
  return [...new Set(value.split(",").filter((s): s is StepCheck => (STEP_IDS as readonly string[]).includes(s)))];
}

export const serializeHidden = (ids: readonly StepCheck[]): string => [...new Set(ids)].join(",");

/** What Today shows: the steps with the hidden ones that are still to do taken out, and the count and the next step worked out again. A step that is done is never hidden (it is the progress). */
export function withoutHidden(activation: Activation, hidden: readonly StepCheck[]): Activation {
  const steps: StartStep[] = activation.steps.filter((s) => s.state === "done" || !hidden.includes(s.check));
  return { steps, done: steps.filter((s) => s.state === "done").length, total: steps.length, next: steps.find((s) => s.state === "todo") ?? null };
}

/** The steps this browser put away for a workspace. SERVER ONLY; outside a request (a test, a build) none. */
export async function readHidden(tenantId: string): Promise<StepCheck[]> {
  try {
    return parseHidden((await cookies()).get(hiddenStepsCookie(tenantId))?.value);
  } catch {
    return [];
  }
}
