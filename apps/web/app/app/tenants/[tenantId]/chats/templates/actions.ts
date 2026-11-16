"use server";

import { revalidatePath } from "next/cache";

import type { Out, TemplatesOut } from "@/components/v2/app/whatsapp/wa-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { ApiRequestError } from "@/lib/api/client";
import { failureOf } from "@/lib/api/failure";
import { submitTemplate, submitTemplateDrafts, syncTemplates } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

/**
 * The message templates, what the Owner or an Admin does (C1, 16 Nov): send the drafts to WhatsApp for review (all, or one), and ask what WhatsApp answered. Sending needs the second factor (the API asks: a closed `mfa` word with the way to Security); checking does not. Each answer is the templates as they stand now.
 */
async function runTemplates(tenantId: string, ids: string[], work: (token: string) => Promise<TemplatesOut>): Promise<Out<TemplatesOut>> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId) || ids.some((i) => !isCanonicalUuid(i))) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const data = await work(user.accessToken);
    revalidatePath(`/app/tenants/${tenantId}/chats/templates`);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data };
  } catch (error) {
    // WhatsApp refused one template: the API's own sentence ("... WhatsApp says: ...") is shown as it is, never swallowed (C1, 16 Nov)
    if (error instanceof ApiRequestError && error.code === "whatsapp_refused" && error.message.trim() !== "") return { ok: false, kind: "other", error: error.message.trim().slice(0, 500), code: "whatsapp_refused" };
    return failureOf(error, t);
  }
}
export async function submitDraftsAction(tenantId: string): Promise<Out<TemplatesOut>> {
  return runTemplates(tenantId, [], (token) => submitTemplateDrafts(token, tenantId));
}
export async function submitTemplateAction(tenantId: string, templateId: string): Promise<Out<TemplatesOut>> {
  return runTemplates(tenantId, [templateId], async (token) => ({ templates: [await submitTemplate(token, tenantId, templateId)] }));
}
export async function syncTemplatesAction(tenantId: string): Promise<Out<TemplatesOut>> {
  return runTemplates(tenantId, [], (token) => syncTemplates(token, tenantId));
}
