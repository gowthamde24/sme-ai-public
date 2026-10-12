"use server";

import { revalidatePath } from "next/cache";

import type { Out, ReplyResult } from "@/components/v2/app/whatsapp/wa-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { approveOutboxMessage, OUTBOX_LANGUAGES, rejectOutboxMessage, submitOutboxMessage, type OutboxLanguage, type OutboxMessage } from "@/lib/api/outbox";
import { getThread, markConversationRead, type Thread } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

/**
 * Customer chats, what a person does in a chat (job CC, screen 5). A reply is a NEW message through the outbox, with the words the person wrote and the category "reply to what the customer wrote": the policy decides, as it does for every
 * message (consent, a customer who asked us to stop, quiet hours, the 24-hour window, the owner's OK for money and promises). Approving a waiting message sends it (Owner and Admin, second factor); declining blocks it. Every answer is
 * the state and the closed reason, or one sentence of ours with the API's closed code. Nothing here sends a message by itself.
 */
const result = (m: OutboxMessage): ReplyResult => ({ status: m.status, reason: m.reason });

async function run<T>(tenantId: string, ids: string[], inputOk: boolean, work: (token: string) => Promise<T>): Promise<Out<T>> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!inputOk || !isCanonicalUuid(tenantId) || ids.some((i) => !isCanonicalUuid(i))) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    return { ok: true, data: await work(user.accessToken) };
  } catch (error) {
    return failureOf(error, t);
  }
}

export async function replyAction(tenantId: string, leadId: string, messageId: string, text: string, language: string): Promise<Out<ReplyResult>> {
  const out = await run(tenantId, [leadId, messageId], typeof text === "string" && text.trim().length >= 1 && text.length <= 1000 && (OUTBOX_LANGUAGES as readonly string[]).includes(language), async (token) =>
    result((await submitOutboxMessage(token, tenantId, { messageId, leadId, text: text.trim(), language: language as OutboxLanguage, category: "reply_to_inbound" })).message),
  );
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/chats`);
  return out;
}
export async function approveChatMessageAction(tenantId: string, messageId: string): Promise<Out<ReplyResult>> {
  const out = await run(tenantId, [messageId], true, async (token) => result((await approveOutboxMessage(token, tenantId, messageId)).message));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/outbox`);
  return out;
}
export async function rejectChatMessageAction(tenantId: string, messageId: string): Promise<Out<ReplyResult>> {
  const out = await run(tenantId, [messageId], true, async (token) => result((await rejectOutboxMessage(token, tenantId, messageId)).message));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/outbox`);
  return out;
}
export async function refreshThreadAction(tenantId: string, leadId: string): Promise<Out<Thread>> {
  return run(tenantId, [leadId], true, (token) => getThread(token, tenantId, leadId));
}
export async function markReadAction(tenantId: string, leadId: string): Promise<Out<null>> {
  return run(tenantId, [leadId], true, async (token) => {
    await markConversationRead(token, tenantId, leadId);
    return null;
  });
}
