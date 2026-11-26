import { ApiAuthError, ApiContractError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { isRec } from "@/lib/api/shape";
import { displayNumber, isNumber } from "@/lib/phone-picker/types";

/** A workspace phone line an AI employee can answer: the id the employee route takes (`phone_number_id`) and the number as people write it. */
export type EmployeeLine = { readonly id: string; readonly display: string };

/**
 * The workspace's phone lines for the Phone tab of an AI employee: a read of `GET /numbers` (any member). A row counts only when the API names its `id` (the employee route needs it): an answer without ids (an API that does not send them yet) is an empty
 * list, and the tab then says the lines cannot be picked yet. Never throws except for a lost session. SERVER ONLY.
 */
export async function readEmployeeLines(token: string, tenantId: string): Promise<EmployeeLine[] | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  try {
    const json = await apiRequest(`/v1/tenants/${tenantId}/numbers`, token);
    if (!isRec(json)) return null;
    const rows = Array.isArray(json.numbers) ? json.numbers.slice(0, 20) : [];
    const out: EmployeeLine[] = [];
    for (const row of rows) {
      if (!isRec(row) || typeof row.id !== "string" || !isCanonicalUuid(row.id) || !isNumber(row.number)) continue;
      out.push({ id: row.id, display: displayNumber(row.number) });
    }
    return out;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
