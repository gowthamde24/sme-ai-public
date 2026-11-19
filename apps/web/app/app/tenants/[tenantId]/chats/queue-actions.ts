"use server";

import { isCanonicalUuid } from "@/lib/api/crm";
import { cancelQueued, queueMessage, readQueued, type QueuedMessage, type QueueRefusal, type QueueResult } from "@/lib/api/chat-queue";
import { requireUser } from "@/lib/auth/session";

import { STAFF, who } from "../retailers/finder-guard";

/**
 * The composer queue of a chat (CHAT_QUEUE_SCREENS; the adapter is lib/api/chat-queue.ts). Owner, Admin and Sales queue and cancel (a Viewer cannot: the page does not show them the chat, and these refuse them too). Every answer is a closed word, never prose: the words are the screen's own,
 * in the person's language. Nothing here sends a message: the API sends the approved hello and, when the customer replies, releases the typed text through the outbox with every rule applied again.
 */
export type QueueOut<T> = QueueResult<T>;
const no = (refusal: QueueRefusal): { ok: false; refusal: QueueRefusal } => ({ ok: false, refusal });
const ids = (tenantId: string, leadId: string): boolean => isCanonicalUuid(tenantId) && isCanonicalUuid(leadId);

export async function queueMessageAction(tenantId: string, leadId: string, clientId: string, text: string): Promise<QueueOut<QueuedMessage>> {
  if (!ids(tenantId, leadId) || typeof text !== "string" || typeof clientId !== "string") return no("text_invalid");
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return no(ctx.kind === "forbidden" ? "forbidden" : "down");
  return queueMessage(ctx.token, tenantId, leadId, { text, clientId });
}
export async function cancelQueuedAction(tenantId: string, leadId: string, id: string): Promise<QueueOut<{ id: string; status: "cancelled" }>> {
  if (!ids(tenantId, leadId) || typeof id !== "string") return no("text_invalid");
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return no(ctx.kind === "forbidden" ? "forbidden" : "down");
  return cancelQueued(ctx.token, tenantId, leadId, id);
}
/** The 5-second read while the chat is open: `data` null = none, undefined = the part is off. The signed-in person's own token; the API decides who may read. */
export async function pollQueuedAction(tenantId: string, leadId: string): Promise<QueueOut<QueuedMessage | null | undefined>> {
  if (!ids(tenantId, leadId)) return no("text_invalid");
  const user = await requireUser();
  try {
    return { ok: true, data: await readQueued(user.accessToken, tenantId, leadId) };
  } catch {
    return no("down");
  }
}
