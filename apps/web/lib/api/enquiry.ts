import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad } from "./shape";

/**
 * "Done" on Today's "Enquired again" (C1 #810, 18 Nov): a person handled it, so it leaves Today. `POST /v1/tenants/{t}/leads/{lead_id}/enquiry-done` (Owner, Admin and Sales; no body) answers `{"handled": n}`. It clears only when a PERSON handles it
 * (a typed reply, a call, this button, or opening the lead); an automated send never clears it. The number handled is not needed: a 200 is "done".
 */
export async function markEnquiryDone(token: string, tenantId: string, leadId: string): Promise<void> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) bad("lead id");
  await apiRequest(`/v1/tenants/${tenantId}/leads/${leadId}/enquiry-done`, token, { method: "POST" });
}
