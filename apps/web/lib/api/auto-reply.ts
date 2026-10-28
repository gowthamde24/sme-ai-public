import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseAutoReply, type AutoReply } from "@/lib/auto-reply/types";

/** `GET /v1/tenants/{id}/ai-assistant/auto-reply` (any member) and `PUT` (Owner with the second factor, `{enabled}`): the switch for the assistant's automatic WhatsApp replies. SERVER ONLY, with the person's own token. */
const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-assistant/auto-reply`;
};
const need = (v: AutoReply | null): AutoReply => {
  if (v === null) throw new ApiContractError("Unexpected auto-reply response.");
  return v;
};
export const getAutoReply = async (token: string, tenantId: string): Promise<AutoReply> => need(parseAutoReply(await apiRequest(path(tenantId), token)));
export const putAutoReply = async (token: string, tenantId: string, enabled: boolean): Promise<AutoReply> => need(parseAutoReply(await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify({ enabled }) })));
