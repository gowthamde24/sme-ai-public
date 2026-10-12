import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, optStr, rec } from "./shape";

/**
 * GSTIN (job CC, screen 6; ADR 0081, the contract is in job CA's report): the shop's own number (the business profile) and a business customer's (a company). Server side only, with the person's own token. A GSTIN is
 * only checked for FORM (state code, PAN shape, check character): nothing says the business exists or is active. A customer's GSTIN holds the owner's PAN, so it is personal data of a sole proprietor and is erased with the
 * company. The API forgives spaces, dashes and small letters and answers the plain 15 characters.
 */
export interface BusinessProfile {
  gstin: string | null;
  /** The state or territory the number's first two digits name (null when there is no number). */
  state: string | null;
}
export function parseBusinessProfile(json: unknown): BusinessProfile {
  const x = rec(json, "business profile");
  return { gstin: optStr(x.gstin, "gstin", 20), state: optStr(x.state, "state", 100) };
}
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return `/v1/tenants/${tenantId}`;
};
/** Every member. */
export async function getBusinessProfile(token: string, tenantId: string): Promise<BusinessProfile> {
  return parseBusinessProfile(await apiRequest(`${base(tenantId)}/business-profile`, token));
}
/** Owner or Admin, with the second factor. `null` removes the number; the key is always sent (an empty body is a 422 on purpose). */
export async function putBusinessProfile(token: string, tenantId: string, gstin: string | null): Promise<BusinessProfile> {
  return parseBusinessProfile(await apiRequest(`${base(tenantId)}/business-profile`, token, { method: "PUT", body: JSON.stringify({ gstin }) }));
}
/** Owner, Admin or Sales. `null` removes the number from the company; a company with a number replaced by a new one keeps only the new one. */
export async function setCompanyGstin(token: string, tenantId: string, companyId: string, gstin: string | null): Promise<string | null> {
  if (!isCanonicalUuid(companyId)) bad("company id");
  const x = rec(await apiRequest(`${base(tenantId)}/companies/${companyId}`, token, { method: "PATCH", body: JSON.stringify({ gstin }) }), "company");
  return optStr(x.gstin, "gstin", 20);
}
