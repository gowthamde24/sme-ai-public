import type { CallLang } from "@/lib/assistant/types";
import { fromApi, toApi, type TalkTraining, type TalkTrainingState } from "@/lib/talk-training/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's "How I talk to customers" (docs/contracts/talk-training.md), with the signed-in person's own token, under `/v1/tenants/{id}`:
 *
 *   GET  /talk-training          Owner, Admin -> TalkTrainingOut {training, saved, defaults, rules, updated_at, wording}
 *   PUT  /talk-training          Owner + second factor (403 mfa_required), the whole document -> TalkTrainingOut; 422 talk_training_invalid {reason}
 *   POST /talk-training/reset    Owner + second factor -> TalkTrainingOut (the defaults)
 *   POST /talk-training/practice Owner, Admin: a practice call in text (app v4, C1 #392) -> {reply, ended, handover, simulated}; nothing is stored or sent, no voice.
 *                                503 practice_unavailable (no model, or it did not answer), 429 practice_busy (past 120 turns an hour), 422 validation_error (the last turn must be the customer's)
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

/** One line of a practice call: the Owner plays the customer, the assistant answers. 1 to 20 turns, each 1 to 400 characters; the last is the customer's. */
export type PracticeTurn = { who: "customer" | "assistant"; text: string };
export type PracticeReply = { reply: string; ended: boolean; handover: boolean };
export const PRACTICE = { turns: 20, text: 400 } as const;

export function parsePracticeReply(json: unknown): PracticeReply {
  if (!isRecord(json) || typeof json.reply !== "string" || json.reply.trim() === "" || typeof json.ended !== "boolean") throw new ApiContractError("Unexpected practice body.");
  return { reply: json.reply.slice(0, 1000), ended: json.ended, handover: json.handover === true };
}
/** `training` = the Owner's unsaved changes, to try them before saving; null = the saved training (or the defaults). */
export const practiceCall = async (token: string, tenantId: string, language: CallLang, turns: readonly PracticeTurn[], training: TalkTraining | null): Promise<PracticeReply> =>
  parsePracticeReply(await apiRequest(`${base(tenantId)}/practice`, token, { method: "POST", body: JSON.stringify({ language, turns, ...(training ? { training: toApi(training) } : {}) }) }));
