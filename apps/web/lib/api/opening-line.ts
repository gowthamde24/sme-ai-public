import { parseCampaignOpeningLine, parseOpeningLine, parsePreview, type CampaignOpeningLine, type Lines, type OpeningLine, type Preview } from "@/lib/opening-line/types";
import type { CallLang } from "@/lib/assistant/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The opening line of a call (night 5; ASSUMED CONTRACT, C1's branch api/du-parity is not merged: when it lands, make the names below match or change this one file). Under `/v1/tenants/{id}/opening-line`, with the signed-in person's own token.
 *
 *   GET  /opening-line                         Owner, Admin  -> { lines: {<lang>: text}, defaults: {te,hi,kn,en,ta,ml: text}, mention_ai: bool, fake?: bool }
 *   PUT  /opening-line                         Owner         { lines: {<lang>: text | null}, mention_ai: bool }   null = back to the default of that language   -> the same answer
 *   GET  /opening-line/campaigns/{campaign}    Owner, Admin  -> { lines: {<lang>: text}, mention_ai: bool | null, effective: { lines: {all six languages}, mention_ai: bool } }
 *   PUT  /opening-line/campaigns/{campaign}    Owner         { lines: {<lang>: text | null}, mention_ai: bool | null }  null = follow the workspace  -> the same answer
 *   POST /opening-line/preview                 Owner, Admin  { language, text, mention_ai }  text has its placeholders FILLED by the web (made-up customer, the workspace's own assistant and business names)
 *                                                            -> { audio_base64: string | null, mime, seconds, fake?: bool }  (the workspace's voice and speaking style; null audio = the voice service is off)
 * A text is 5 to 300 characters with only {customer} {assistant} {business} {agent_role}; anything else is 422. Changing the setting is written to the audit log by the API (who, when). The API has no DELETE verb: reset = PUT null.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/opening-line`;
};
const campaignPath = (tenantId: string, campaignId: string): string => {
  if (!isCanonicalUuid(campaignId)) throw new ApiContractError("id");
  return `${base(tenantId)}/campaigns/${campaignId}`;
};
const wire = (lines: Partial<Record<CallLang, string | null>>): Record<string, string | null> => Object.fromEntries(Object.entries(lines).filter(([, v]) => v !== undefined)) as Record<string, string | null>;
const checked = <T>(value: T | null, what: string): T => {
  if (value === null) throw new ApiContractError(`Unexpected ${what} response.`);
  return value;
};

export const getOpeningLine = async (token: string, tenantId: string): Promise<OpeningLine> => checked(parseOpeningLine(await apiRequest(base(tenantId), token)), "opening line");
export const putOpeningLine = async (token: string, tenantId: string, lines: Partial<Record<CallLang, string | null>>, mentionAi: boolean): Promise<OpeningLine> =>
  checked(parseOpeningLine(await apiRequest(base(tenantId), token, { method: "PUT", body: JSON.stringify({ lines: wire(lines), mention_ai: mentionAi }) })), "opening line");
export const getCampaignOpeningLine = async (token: string, tenantId: string, campaignId: string): Promise<CampaignOpeningLine> => checked(parseCampaignOpeningLine(await apiRequest(campaignPath(tenantId, campaignId), token)), "campaign opening line");
export const putCampaignOpeningLine = async (token: string, tenantId: string, campaignId: string, lines: Partial<Record<CallLang, string | null>>, mentionAi: boolean | null): Promise<CampaignOpeningLine> =>
  checked(parseCampaignOpeningLine(await apiRequest(campaignPath(tenantId, campaignId), token, { method: "PUT", body: JSON.stringify({ lines: wire(lines), mention_ai: mentionAi }) })), "campaign opening line");
export const previewOpeningLine = async (token: string, tenantId: string, language: CallLang, text: string, mentionAi: boolean): Promise<Preview> =>
  checked(parsePreview(await apiRequest(`${base(tenantId)}/preview`, token, { method: "POST", body: JSON.stringify({ language, text, mention_ai: mentionAi }) })), "preview");

export type { Lines };
