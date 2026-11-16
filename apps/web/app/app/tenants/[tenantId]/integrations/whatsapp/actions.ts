"use server";

import { revalidatePath } from "next/cache";

import type { Out } from "@/components/v2/app/whatsapp/wa-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { activateWhatsapp, disableWhatsapp, putWhatsappAccount, type WhatsappAccount } from "@/lib/api/whatsapp";
import { requireUser } from "@/lib/auth/session";

/**
 * Connect WhatsApp, what the Owner does (job CC, screen 5): save the number's details (the ids and the NAME of the access key, never the key), switch it on, switch it off. The Owner only, with the second factor (the API
 * checks). Each answer is the account as the server now has it, or one sentence of ours with the API's closed code.
 */
const DIGITS = /^\d{5,40}$/;
const NAME = /^[A-Za-z0-9_-]{1,80}$/;

async function run(tenantId: string, ok: boolean, work: (token: string) => Promise<WhatsappAccount>): Promise<Out<WhatsappAccount>> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!ok || !isCanonicalUuid(tenantId)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const data = await work(user.accessToken);
    revalidatePath(`/app/tenants/${tenantId}/integrations`);
    return { ok: true, data };
  } catch (error) {
    return failureOf(error, t);
  }
}

export async function saveWhatsappAction(tenantId: string, f: { wabaId: string; phoneNumberId: string; displayPhone: string; coexistence: boolean; tokenRef: string }): Promise<Out<WhatsappAccount>> {
  const ok = DIGITS.test(String(f?.wabaId).trim()) && DIGITS.test(String(f?.phoneNumberId).trim()) && NAME.test(String(f?.tokenRef).trim()) && typeof f.coexistence === "boolean" && String(f.displayPhone ?? "").length <= 40;
  return run(tenantId, ok, (token) => putWhatsappAccount(token, tenantId, f));
}
export async function activateWhatsappAction(tenantId: string): Promise<Out<WhatsappAccount>> {
  return run(tenantId, true, (token) => activateWhatsapp(token, tenantId));
}
export async function disableWhatsappAction(tenantId: string): Promise<Out<WhatsappAccount>> {
  return run(tenantId, true, (token) => disableWhatsapp(token, tenantId));
}
