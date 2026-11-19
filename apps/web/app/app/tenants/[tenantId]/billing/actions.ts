"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { saveLimit } from "@/lib/api/wallet";
import { claimFreeStart, testTopup, type Moved } from "@/lib/billing-v6/source";
import { clock } from "@/lib/clock";

/** The two changes of the Billing page: the free ₹50 start (the Owner, once) and a TEST top-up (Owner and Admin; only with BALANCE_SCREENS=mock, the real top-up is Razorpay's later). The answer is a sentence in our words, never the API's. */
export type BillingResult = { ok: true } | { ok: false; error: string };

async function who(tenantId: string, owner: boolean): Promise<{ token: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    return role === "owner" || (!owner && role === "admin") ? { token: user.accessToken } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

const said = (t: ReturnType<typeof appT>, m: Moved): BillingResult => (m.ok ? { ok: true } : { ok: false, error: t(m.error === "forbidden" ? "bv6.err.role" : m.error === "not_available" ? "bv6.err.na" : "bv6.err.generic") });

export async function freeStartAction(tenantId: string): Promise<BillingResult> {
  const t = appT(await getLang());
  const me = await who(tenantId, true);
  if (!me) return { ok: false, error: t("bv6.err.role") };
  const out = said(t, await claimFreeStart(me.token, tenantId));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}`, "layout");
  return out;
}

export async function topupAction(tenantId: string, paise: unknown): Promise<BillingResult> {
  const t = appT(await getLang());
  const me = await who(tenantId, false);
  if (!me) return { ok: false, error: t("bv6.err.role") };
  const out = said(t, await testTopup(paise, new Date(clock()), randomUUID().slice(0, 8)));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}`, "layout");
  return out;
}

/** The optional spending limit of one feature for the month (Owner and Admin): paise, or null for no limit. Billing v2 (BILLING_V2) only; the answer is a sentence in our words. */
export async function setLimitAction(tenantId: string, feature: unknown, paise: unknown): Promise<BillingResult> {
  const t = appT(await getLang());
  const me = await who(tenantId, false);
  if (!me) return { ok: false, error: t("bill.limit.role") };
  const out = await saveLimit(me.token, tenantId, feature, paise);
  if (out.ok) {
    revalidatePath(`/app/tenants/${tenantId}/billing`);
    return { ok: true };
  }
  return { ok: false, error: t(out.error === "forbidden" ? "bill.limit.role" : out.error === "not_available" ? "bill.limit.na" : "bill.limit.err") };
}
