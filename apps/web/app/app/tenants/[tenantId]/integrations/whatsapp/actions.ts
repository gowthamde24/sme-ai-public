"use server";

import { revalidatePath } from "next/cache";

import type { Out } from "@/components/v2/app/whatsapp/wa-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { activateWhatsapp, connectWhatsapp, disableWhatsapp, disconnectWhatsapp, putWhatsappAccount, SIGNUP_CODE, SIGNUP_ID, type Connected, type ConnectInput, type WhatsappAccount } from "@/lib/api/whatsapp";
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
/** "Disconnect" (Owner, with the second factor): the account is switched off and our app leaves its webhooks; the chats stay. The answer is the account as it now stands (`disabled`). */
export async function disconnectWhatsappAction(tenantId: string): Promise<Out<WhatsappAccount>> {
  return run(tenantId, true, (token) => disconnectWhatsapp(token, tenantId));
}

/**
 * "Connect with Facebook" (Meta Embedded Signup): the browser finished Meta's window and hands over the short code and the account and number the shop picked. The Owner only, with the second factor (the API checks, and checks the signup was made in OUR app and shared this account).
 * The format of each value is checked here first, so nothing odd travels to the API. The answer is the number and the name WhatsApp verified; a refusal is one sentence of ours for the API's closed code.
 */
export async function connectWithFacebookAction(tenantId: string, f: ConnectInput): Promise<Out<Connected>> {
  const user = await requireUser();
  const t = appT(await getLang());
  const ok = isCanonicalUuid(tenantId) && typeof f?.code === "string" && SIGNUP_CODE.test(f.code) && (f.wabaId === undefined || (typeof f.wabaId === "string" && SIGNUP_ID.test(f.wabaId))) && (f.messagingAccountIds === undefined || (Array.isArray(f.messagingAccountIds) && f.messagingAccountIds.length <= 5 && f.messagingAccountIds.every((x) => typeof x === "string" && SIGNUP_ID.test(x)))) && (f.wabaId !== undefined || (f.messagingAccountIds?.length ?? 0) > 0) && (f.phoneNumberId === undefined || (typeof f.phoneNumberId === "string" && SIGNUP_ID.test(f.phoneNumberId))) && (f.coexistence === undefined || f.coexistence === true) && (f.isOnBizApp === undefined || typeof f.isOnBizApp === "boolean");
  if (!ok) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const data = await connectWhatsapp(user.accessToken, tenantId, { code: f.code, ...(f.wabaId !== undefined ? { wabaId: f.wabaId } : {}), ...(f.messagingAccountIds !== undefined ? { messagingAccountIds: f.messagingAccountIds } : {}), ...(f.phoneNumberId !== undefined ? { phoneNumberId: f.phoneNumberId } : {}), ...(f.coexistence === true ? { coexistence: true as const } : {}), ...(f.isOnBizApp !== undefined ? { isOnBizApp: f.isOnBizApp } : {}) });
    revalidatePath(`/app/tenants/${tenantId}/integrations`);
    return { ok: true, data };
  } catch (error) {
    return failureOf(error, t);
  }
}
