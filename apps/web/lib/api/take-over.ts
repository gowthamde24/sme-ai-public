import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseTakeOver, type TakeOver } from "@/lib/take-over/types";

/** `GET /v1/tenants/{id}/calls/take-over-setting` (Owner, Admin, Sales) and `PUT` (Owner, `{enabled}`): the business's switch for live take-over. SERVER ONLY, with the person's token. */
const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/calls/take-over-setting`;
};
const need = (v: TakeOver | null): TakeOver => {
  if (v === null) throw new ApiContractError("Unexpected take-over response.");
  return v;
};
export const getTakeOver = async (token: string, tenantId: string): Promise<TakeOver> => need(parseTakeOver(await apiRequest(path(tenantId), token)));
export const putTakeOver = async (token: string, tenantId: string, enabled: boolean): Promise<TakeOver> => need(parseTakeOver(await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify({ enabled }) })));
