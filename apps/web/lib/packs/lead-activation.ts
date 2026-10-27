import { listLeadTemplates } from "@/lib/api/lead-templates";
import { ApiAuthError } from "@/lib/api/client";
import { enabledFeatures } from "@/lib/screens/features";

import type { LeadDeskStep } from "./activation";
import type { WorkspacePack } from "./types";

/**
 * The Lead Desk steps of the first-run checklist (night 4): only for a business type that has a Lead Desk template (the API's own list, `GET /v1/lead-templates`; no business type is named here), and each only while its part of
 * the product is on: a lead source or import (`leads`), a call rule (`outreach`), "Ask {assistant} to do it" (`tasks`). A list that cannot be read gives no steps, never a wrong one.
 */
export async function leadDeskSteps(pack: Pick<WorkspacePack, "packId">): Promise<LeadDeskStep[]> {
  const on = enabledFeatures();
  if (!on.includes("leads")) return [];
  try {
    if (!(await listLeadTemplates()).some((t) => t.packId === pack.packId)) return [];
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return [];
  }
  const steps: LeadDeskStep[] = ["lead_source_added"];
  if (on.includes("outreach")) steps.push("call_rule_approved");
  if (on.includes("tasks")) steps.push("ask_assistant_tried");
  return steps;
}
