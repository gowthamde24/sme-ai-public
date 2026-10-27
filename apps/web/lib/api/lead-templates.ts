import { parseTemplates, type LeadTemplate } from "@/lib/lead-desk/templates";

import { apiPublicRequest } from "./client";

/** `GET /v1/lead-templates` (public, cached five minutes by the API): the nine "any business with leads" types for the sign-up picker. Server side only. */
export async function listLeadTemplates(): Promise<LeadTemplate[]> {
  return parseTemplates(await apiPublicRequest("/v1/lead-templates"));
}
