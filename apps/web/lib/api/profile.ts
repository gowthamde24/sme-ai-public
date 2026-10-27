import { ApiContractError, apiRequest } from "./client";

/**
 * The business's basics (job BY: `GET/PUT /v1/tenants/{id}/profile`): the name, the town and the languages. The first step of every pack's checklist asks the name and the city here, once, in context (progressive
 * profiling, blueprint principle 5). Server side only, with the signed-in person's own token. Owner or Admin may save; any member may read.
 */
export interface BusinessProfile {
  name: string;
  town: string | null;
  /** The languages the business talks to customers in (codes the API knows); empty when none is saved yet. */
  languages: string[];
  setupComplete: boolean;
}

export const PROFILE_LANGUAGES = ["en", "te", "hi", "kn", "ta", "ml"] as const;

export function parseProfile(json: unknown): BusinessProfile {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ApiContractError("Unexpected body in a profile response.");
  const r = json as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length < 1 || r.name.length > 200) throw new ApiContractError("Unexpected name in a profile response.");
  if (r.town !== null && r.town !== undefined && (typeof r.town !== "string" || r.town.length > 200)) throw new ApiContractError("Unexpected town in a profile response.");
  const languages = Array.isArray(r.languages) ? r.languages.filter((l): l is string => typeof l === "string" && (PROFILE_LANGUAGES as readonly string[]).includes(l)) : [];
  return { name: r.name, town: typeof r.town === "string" && r.town.trim() !== "" ? r.town : null, languages, setupComplete: r.setup_complete === true };
}

export async function getProfile(accessToken: string, tenantId: string): Promise<BusinessProfile> {
  return parseProfile(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/profile`, accessToken));
}

/** Each field is optional on the server: what is left out is kept. */
export async function saveProfile(accessToken: string, tenantId: string, input: { name?: string; town?: string; languages?: string[] }): Promise<BusinessProfile> {
  return parseProfile(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/profile`, accessToken, { method: "PUT", body: JSON.stringify(input) }));
}
