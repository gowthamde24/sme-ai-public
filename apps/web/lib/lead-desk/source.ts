import { listLeadTemplates } from "@/lib/api/lead-templates";
import { leadsScreens } from "@/lib/screens/flag";

import { MOCK_TEMPLATES, type LeadTemplate } from "./templates";

/**
 * Where the lead templates come from (night 4, part A1): `mock` = the made-up nine, `on` = the API, `off` = none (the sign-up is the one it always was). A template list that cannot be read is `[]`: the sign-up then shows the business
 * types as the API lists them, never a card that leads nowhere. SERVER ONLY.
 */
export async function readTemplates(): Promise<LeadTemplate[]> {
  const mode = leadsScreens();
  if (mode === "off") return [];
  if (mode === "mock") return [...MOCK_TEMPLATES];
  try {
    return await listLeadTemplates();
  } catch {
    return [];
  }
}
