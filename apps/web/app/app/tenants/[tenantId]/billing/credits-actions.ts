"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { confirmOrder, createOrder, failOrder, failOf, getStatement, type CreditsFail, type Order, type Statement } from "@/lib/api/credits";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

/**
 * The moves of the credits screens (flag CREDITS_SCREENS; C1's docs/contracts/credits-topup.md): make a top-up order (Owner; whole rupees 100 to 1,00,000), confirm it with Razorpay's payment id and signature (the server checks the signature; safe to repeat), record
 * why a checkout did not finish, and read earlier statement lines. Each answer is a closed word the screen draws in plain language.
 */
async function owner(tenantId: string): Promise<{ token: string } | CreditsFail> {
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "unavailable" };
  const user = await requireUser();
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "unavailable" };
  }
  return { token: user.accessToken };
}
const isFail = (v: { token: string } | CreditsFail): v is CreditsFail => "ok" in v;

export async function createTopupAction(tenantId: string, amountRupees: unknown): Promise<{ ok: true; order: Order } | CreditsFail> {
  const who = await owner(tenantId);
  if (isFail(who)) return who;
  if (typeof amountRupees !== "number" || !Number.isInteger(amountRupees) || amountRupees < 100 || amountRupees > 100_000) return { ok: false, error: "amount" };
  try {
    return { ok: true, order: await createOrder(who.token, tenantId, amountRupees) };
  } catch (error) {
    return failOf(error);
  }
}
export async function confirmTopupAction(tenantId: string, orderId: unknown, paymentId: unknown, signature: unknown): Promise<{ ok: true; addedText: string } | CreditsFail> {
  const who = await owner(tenantId);
  if (isFail(who)) return who;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string" || orderId.length > 80 || paymentId.length > 80 || signature.length > 200) return { ok: false, error: "unavailable" };
  try {
    const r = await confirmOrder(who.token, tenantId, orderId, paymentId, signature);
    revalidatePath(`/app/tenants/${tenantId}/billing`);
    return { ok: true, addedText: r.addedText };
  } catch (error) {
    return failOf(error);
  }
}
export async function failTopupAction(tenantId: string, orderId: unknown, reason: unknown): Promise<void> {
  const who = await owner(tenantId);
  if (isFail(who) || typeof orderId !== "string" || orderId.length > 80) return;
  try {
    await failOrder(who.token, tenantId, orderId, reason === "dismissed" || reason === "cancelled" ? reason : "failed");
  } catch {
    // only a record of why: never shown
  }
}
export async function loadStatementAction(tenantId: string, before: unknown): Promise<{ ok: true; statement: Statement } | CreditsFail> {
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "unavailable" };
  const user = await requireUser();
  try {
    return { ok: true, statement: await getStatement(user.accessToken, tenantId, typeof before === "string" && before.length <= 80 ? before : null) };
  } catch (error) {
    return failOf(error);
  }
}
