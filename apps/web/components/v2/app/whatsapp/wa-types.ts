import type { FailedTemplate, RenamedTemplate, Template, Thread, WhatsappAccount } from "@/lib/api/whatsapp";

import type { Failed } from "../cc/kit";

export type Out<T> = { ok: true; data: T } | Failed;
export interface AccountActions {
  save: (f: { wabaId: string; phoneNumberId: string; displayPhone: string; coexistence: boolean; tokenRef: string }) => Promise<Out<WhatsappAccount>>;
  activate: () => Promise<Out<WhatsappAccount>>;
  disable: () => Promise<Out<WhatsappAccount>>;
  /** Disconnect: off and out of the account's webhooks; optional so a screen drawn without it shows no such button. */
  disconnect?: () => Promise<Out<WhatsappAccount>>;
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
/** What a template action answers: the templates as they stand now (the rows are drawn from them), and the counts the API gave. */
export interface TemplatesOut {
  templates: Template[];
  submitted?: number;
  refused?: number;
  /** The drafts WhatsApp did not accept, each with its reason (never silent). */
  failed?: FailedTemplate[];
  /** The drafts sent under a new name because WhatsApp already held the old one. */
  renamed?: RenamedTemplate[];
  changed?: number;
}
export interface TemplateActions {
  submitDrafts: () => Promise<Out<TemplatesOut>>;
  submitOne: (templateId: string) => Promise<Out<TemplatesOut>>;
  sync: () => Promise<Out<TemplatesOut>>;
}
