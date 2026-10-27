import { parsePlaybook, playbookPutBody, type PlaybookBody, type PlaybookQuestion, type PlaybookRead } from "@/lib/lead-desk/playbook";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/** The workspace's lead playbook (night 4, part A1): `GET` any member, `PUT` and `POST reset` the Owner with the second factor. SERVER ONLY, with the person's own token. */
const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/lead-playbook`;
};
export const getPlaybook = async (token: string, tenantId: string): Promise<PlaybookRead> => parsePlaybook(await apiRequest(path(tenantId), token));
export const putPlaybook = async (token: string, tenantId: string, current: PlaybookBody, edit: { goalAsk: string; questions: readonly PlaybookQuestion[] }): Promise<PlaybookRead> => parsePlaybook(await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify(playbookPutBody(current, edit)) }));
export const resetPlaybook = async (token: string, tenantId: string): Promise<PlaybookRead> => parsePlaybook(await apiRequest(`${path(tenantId)}/reset`, token, { method: "POST", body: JSON.stringify({}) }));
