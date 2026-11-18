import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, isRec, optStr, rec, uuid } from "./shape";

/**
 * "Ask for consent" with one tap (campaigns S4, C1's contract of 18 Nov; Owner and Admin). PREVIEW `GET /leads/{id}/consent-ask` reads and writes nothing: the exact words that would go, in the customer's language, how they would go (a plain message
 * inside WhatsApp's 24 hours, an approved template outside it, or not at all) and a `message_id`. SEND `POST` with that id is the owner's tap and IS the approval (the same id twice is one message); it goes through the outbox like any owner message
 * (quiet hours, daily limit, STOP). The customer's "OK" is not recorded automatically: the owner reads it in Chats and records consent. A reason or a how this screen does not know is "cannot ask now", never a guess.
 */
export const REASONS = ["already_agreed", "stopped", "no_whatsapp_number", "no_template"] as const;
export type AskReason = (typeof REASONS)[number] | "unknown";
export type AskHow = "message" | "template" | "none";
export type ConsentAskPreview = { leadId: string; customer: string | null; needed: boolean; reason: AskReason | null; language: string | null; text: string | null; how: AskHow; windowOpen: boolean; messageId: string | null };

export function parseConsentAsk(json: unknown): ConsentAskPreview {
  const r = rec(json, "consent ask");
  const how: AskHow = r.how === "message" || r.how === "template" ? r.how : "none";
  const reason: AskReason | null = r.reason === null || r.reason === undefined ? null : (REASONS as readonly unknown[]).includes(r.reason) ? (r.reason as AskReason) : "unknown";
  const text = optStr(r.text, "text", 1200);
  const messageId = r.message_id === null || r.message_id === undefined ? null : uuid(r.message_id, "message_id");
  // something that can go needs its words and its id; without them it cannot be sent
  const sendable = how !== "none" && text !== null && text.trim() !== "" && messageId !== null;
  return {
    leadId: uuid(r.lead_id, "lead_id"),
    customer: optStr(r.customer, "customer", 200),
    needed: bool(r.needed, "needed"),
    reason: sendable ? reason : (reason ?? "unknown"),
    language: optStr(r.language, "language", 10),
    text,
    how: sendable ? how : "none",
    windowOpen: r.window_open === true,
    messageId,
  };
}

const path = (tenantId: string, leadId: string) => {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/leads/${leadId}/consent-ask`;
};

export async function getConsentAsk(token: string, tenantId: string, leadId: string): Promise<ConsentAskPreview> {
  return parseConsentAsk(await apiRequest(path(tenantId, leadId), token));
}

/** The owner's tap: sends the words of the preview that has this `messageId`. Answers whether it was a replay (the same id again). */
export async function sendConsentAsk(token: string, tenantId: string, leadId: string, messageId: string): Promise<{ replayed: boolean }> {
  if (!isCanonicalUuid(messageId)) throw new ApiContractError("message_id");
  const json = await apiRequest(path(tenantId, leadId), token, { method: "POST", body: JSON.stringify({ message_id: messageId }) });
  return { replayed: isRec(json) && json.replayed === true };
}
