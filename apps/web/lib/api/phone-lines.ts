import { parseLines, type Lines } from "@/lib/phone-lines/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/** `GET /v1/tenants/{t}/phone-lines` (C1, 28 Nov 2026; docs/contracts/calls.md "Calls at once"; Owner and Admin, 403 for the rest). SERVER ONLY, with the person's own token. Null = an answer that does not add up. */
export async function readLines(accessToken: string, tenantId: string): Promise<Lines | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseLines(await apiRequest(`/v1/tenants/${tenantId}/phone-lines`, accessToken));
}
