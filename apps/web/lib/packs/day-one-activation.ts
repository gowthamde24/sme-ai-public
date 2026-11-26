import type { AppT } from "@/i18n/app";
import { ApiAuthError } from "@/lib/api/client";
import { hasOwnName, missingFor } from "@/lib/assistant-status/go-live";
import { readAssistantStatus } from "@/lib/assistant-status/source";
import { doneCount, stepViews, STEP_IDS, type StepId } from "@/components/v2/app/today/v6/day-one/steps";

import { readFacts } from "./activation-facts";
import type { Activation, StartStep, StepCheck } from "./activation";

/** The seven steps of day one, done or not, from what can be read. A fact that cannot be read is "not done". "Practise" has no fact yet (C1's onboarding progress is still to build). */
export async function readDone(token: string, tenantId: string, shop: string, modules: readonly string[], status: NonNullable<Awaited<ReturnType<typeof readAssistantStatus>>>, missing: readonly string[]): Promise<Partial<Record<StepId, boolean>>> {
  const facts: Partial<Record<StepCheck, boolean>> = await readFacts(token, tenantId, ["catalogue_has_items", "lead_source_added"], modules).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : {}));
  return {
    shop: hasOwnName(shop),
    catalogue: facts.catalogue_has_items === true,
    speaks: !status.usingDefaults.includes("voice"),
    rules: !status.usingDefaults.includes("rules"),
    practise: false,
    phone: !missing.includes("phone_number"),
    sources: facts.lead_source_added === true,
  };
}

/**
 * THE one setup checklist (planner, 26 Nov 2026): the seven steps of day one, as the "Finish setup" chip and the checklist on Today count them, in the shape the Start page and Settings draw (they used to draw a second, API-made list of six, so the owner saw "5/7" on Today and "5 of 6" there).
 * Null when the assistant's status cannot be read (the caller then keeps what it had).
 */
export async function readDayOneActivation(args: { token: string; tenantId: string; shop: string; modules: readonly string[]; base: string; t: AppT }): Promise<Activation | null> {
  const { token, tenantId, shop, modules, base, t } = args;
  const status = await readAssistantStatus(token, tenantId);
  if (!status) return null;
  const missing = (await missingFor(status, shop)) ?? [];
  const done = await readDone(token, tenantId, shop, modules, status, missing);
  const views = stepViews(done, base, modules.includes("catalogue"));
  const steps: StartStep[] = views.map((v) => ({ id: v.id, check: "business_profile", title: t(`tv6.d1.step.${v.id}` as never), hint: "", state: v.done ? "done" : "todo", href: v.href }));
  const next = steps.find((s) => s.state === "todo") ?? null;
  return { steps, done: doneCount(views), total: STEP_IDS.length, next };
}
