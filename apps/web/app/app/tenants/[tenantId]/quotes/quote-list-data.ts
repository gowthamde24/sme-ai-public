import { apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { ApiContractError } from "@/lib/api/client";
import { parseQuoteSummary, type QuoteSummary } from "@/lib/api/quotes";

/**
 * GET /v1/tenants/{id}/quotes: the workspace's newest 50 quotes. lib/api has no function for it (only the quotes of one enquiry), so this reads it with the same checked client
 * and the same parser as the per-enquiry list. When Claude 1 adds `fetchQuotes` to lib/api, call that instead and delete this file. The list has no customer name or city
 * (the summary carries only whether the customer is new or repeat): the report asks for them.
 */
export async function fetchQuoteList(accessToken: string, tenantId: string): Promise<QuoteSummary[]> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const json = await apiRequest(`/v1/tenants/${tenantId}/quotes?limit=50`, accessToken);
  if (!Array.isArray(json)) throw new ApiContractError("quotes");
  return json.map(parseQuoteSummary);
}
