import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseOwnVoice, parseSentence, validConsentName, type OwnVoice } from "@/lib/own-voice/types";

/**
 * The Owner's own voice from C1's API (job DP; contract-own-voice.md). Server side only, with the person's own token; making and deleting need the Owner's second factor (403 `mfa_required`). The recordings travel as base64
 * in one JSON body (no multipart); no answer returns a recording or a link to one.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/voice-clone`;
};
const checked = (json: unknown): OwnVoice => parseOwnVoice(json) ?? (() => { throw new ApiContractError("Unexpected own-voice response."); })();

export const getOwnVoice = async (token: string, tenantId: string): Promise<OwnVoice> => checked(await apiRequest(`${base(tenantId)}`, token));

export async function getConsentSentence(token: string, tenantId: string, name: string): Promise<string> {
  if (!validConsentName(name)) throw new ApiContractError("name");
  const s = parseSentence(await apiRequest(`${base(tenantId)}/sentence?${new URLSearchParams({ name: name.trim() })}`, token));
  if (!s) throw new ApiContractError("Unexpected consent sentence.");
  return s;
}

export type OwnVoiceIn = { id: string; name: string; consent_sentence: string; sample_base64: string; sample_type: string; sample_seconds: number; consent_base64: string; consent_type: string; consent_seconds: number };
export const createOwnVoice = async (token: string, tenantId: string, body: OwnVoiceIn): Promise<OwnVoice> => checked(await apiRequest(`${base(tenantId)}`, token, { method: "POST", body: JSON.stringify(body) }));
/** The API has no DELETE verb anywhere (a test of C1 forbids it): "delete my voice" is `POST /voice-clone/delete`, safe to press again. */
export const deleteOwnVoice = async (token: string, tenantId: string): Promise<OwnVoice> => checked(await apiRequest(`${base(tenantId)}/delete`, token, { method: "POST", body: JSON.stringify({}) }));
