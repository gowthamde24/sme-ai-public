import type { Thread, WhatsappAccount } from "@/lib/api/whatsapp";

import type { Failed } from "../cc/kit";

export type Out<T> = { ok: true; data: T } | Failed;
export interface AccountActions {
  save: (f: { wabaId: string; phoneNumberId: string; displayPhone: string; coexistence: boolean; tokenRef: string }) => Promise<Out<WhatsappAccount>>;
  activate: () => Promise<Out<WhatsappAccount>>;
  disable: () => Promise<Out<WhatsappAccount>>;
}
/** What a reply came to: the outbox's own state and closed reason (the policy decides; the screen only says it). */
export interface ReplyResult {
  status: string;
  reason: string;
}
export interface ChatActions {
  reply: (messageId: string, text: string, language: string) => Promise<Out<ReplyResult>>;
  approve: (messageId: string) => Promise<Out<ReplyResult>>;
  reject: (messageId: string) => Promise<Out<ReplyResult>>;
  refresh: () => Promise<Out<Thread>>;
  markRead: () => Promise<Out<null>>;
}
