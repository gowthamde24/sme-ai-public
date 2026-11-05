import { fromApi, toApi, type TalkTraining, type TalkTrainingState } from "@/lib/talk-training/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's "How I talk to customers" (docs/contracts/talk-training.md), with the signed-in person's own token, under `/v1/tenants/{id}`:
 *
 *   GET  /talk-training          Owner, Admin -> TalkTrainingOut {training, saved, defaults, rules, updated_at, wording}
 *   PUT  /talk-training          Owner + second factor (403 mfa_required), the whole document -> TalkTrainingOut; 422 talk_training_invalid {reason}
 *   POST /talk-training/reset    Owner + second factor -> TalkTrainingOut (the defaults)
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/talk-training`;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseTalkTraining(json: unknown): TalkTrainingState {
  if (!isRecord(json) || typeof json.saved !== "boolean" || !Array.isArray(json.rules)) throw new ApiContractError("Unexpected talk-training body.");
  const training = fromApi(json.training);
  const defaults = fromApi(json.defaults);
  const rules = json.rules.filter((r): r is string => typeof r === "string" && r.trim() !== "" && r.length <= 400).slice(0, 20);
  if (!training || !defaults) throw new ApiContractError("Unexpected talk-training document.");
  return { training, defaults, saved: json.saved, rules, updatedAt: typeof json.updated_at === "string" ? json.updated_at : null };
}

export const getTalkTraining = async (token: string, tenantId: string): Promise<TalkTrainingState> => parseTalkTraining(await apiRequest(base(tenantId), token));
export const putTalkTraining = async (token: string, tenantId: string, doc: TalkTraining): Promise<TalkTrainingState> =>
  parseTalkTraining(await apiRequest(base(tenantId), token, { method: "PUT", body: JSON.stringify(toApi(doc)) }));
export const resetTalkTraining = async (token: string, tenantId: string): Promise<TalkTrainingState> => parseTalkTraining(await apiRequest(`${base(tenantId)}/reset`, token, { method: "POST" }));
