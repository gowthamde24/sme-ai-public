import { ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { NO_COUNTS, parseNavCounts, type NavCounts } from "../nav-counts";

export { NO_COUNTS, parseNavCounts, todayCount, type NavCounts } from "../nav-counts";

/** `GET /nav-counts` with the person's own token. A server that does not have the route yet (404) is "nothing known", not an error: the menu simply has no numbers. Any other failure is thrown to the caller. */
export async function getNavCounts(token: string, tenantId: string): Promise<NavCounts> {
  if (!isCanonicalUuid(tenantId)) return NO_COUNTS;
  try {
    return parseNavCounts(await apiRequest(`/v1/tenants/${tenantId}/nav-counts`, token));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return NO_COUNTS;
    throw error;
  }
}
