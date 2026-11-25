"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import type { KycReason, KycStatus } from "@/lib/api/business-kyc";
import { requireUser } from "@/lib/auth/session";
import { checkGst, checkPan, readStatus, saveDetails, startAadhaar, startAccount, submitAll, type KycError, type KycResult } from "@/lib/phone-kyc/source";
import { claimNumber, searchNumbers } from "@/lib/phone-picker/source";
import type { OwnNumber, SearchResult, UnavailableReason } from "@/lib/phone-picker/types";
import { kycPerClient, phonePicker } from "@/lib/screens/flag";

/**
 * The moves of "Get a phone number" (four steps) and "Verify your business" (KYC_PER_CLIENT with PHONE_PICKER). Owner and Admin look for numbers; only the Owner buys and verifies (the API needs the second factor for a purchase too). Every answer is a closed word the
 * screen draws in plain language. Nothing is bought unless the person ticked "How you will use this number" and pressed the last button: the purchase is the one `POST /numbers/claim`, after the business's own account exists.
 */
async function role(tenantId: string): Promise<{ token: string; role: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    return { token: user.accessToken, role: (await fetchTenant(user.accessToken, tenantId)).role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const owner = async (tenantId: string) => {
  const who = await role(tenantId);
  return who && who.role === "owner" ? who : null;
};
const off = (): boolean => phonePicker() === "off" || kycPerClient() === "off";
const forbidden: KycResult<never> = { ok: false, error: "forbidden" };

export type BuyResult = { ok: true; number: OwnNumber; status: KycStatus | null } | { ok: false; error: KycError | "taken" | "unavailable"; reason?: UnavailableReason | KycReason };

export async function searchAvailableAction(tenantId: string, type: unknown, prefix: unknown, page: unknown): Promise<SearchResult> {
  const who = await role(tenantId);
  if (off() || !who || (who.role !== "owner" && who.role !== "admin")) return { ok: false, error: "forbidden" };
  return searchNumbers(who.token, tenantId, type, prefix, page);
}

/** The last step: the business's own account is made (once), then the number is bought. `kyc_required` (the API wants the verification first) is an answer with its own sentence, not a failure to hide. */
export async function buyNumberAction(tenantId: string, input: { number: unknown; type: unknown; accountType: unknown; agree: unknown }): Promise<BuyResult> {
  const who = await owner(tenantId);
  if (off() || !who) return { ok: false, error: "forbidden" };
  if (input?.agree !== true) return { ok: false, error: "invalid" };
  const started = await startAccount(who.token, tenantId, input.accountType);
  if (!started.ok) return { ok: false, error: started.error, reason: started.reason };
  const claimed = await claimNumber(who.token, tenantId, input.number, input.type);
  revalidatePath(`/app/tenants/${tenantId}/phone-number`);
  if (!claimed.ok) return { ok: false, error: claimed.error, reason: claimed.reason };
  return { ok: true, number: claimed.number, status: started.data };
}

export async function kycStatusAction(tenantId: string): Promise<KycStatus | null> {
  const who = await role(tenantId);
  return who && !off() ? readStatus(who.token, tenantId) : null;
}
export async function kycStartAction(tenantId: string, type: unknown): Promise<KycResult> {
  const who = await owner(tenantId);
  return who && !off() ? startAccount(who.token, tenantId, type) : forbidden;
}
export async function kycDetailsAction(tenantId: string, input: Record<string, unknown>): Promise<KycResult> {
  const who = await owner(tenantId);
  return who && !off() ? saveDetails(who.token, tenantId, input ?? {}) : forbidden;
}
export async function kycPanAction(tenantId: string, panNumber: unknown, holderName: unknown): Promise<KycResult> {
  const who = await owner(tenantId);
  return who && !off() ? checkPan(who.token, tenantId, panNumber, holderName) : forbidden;
}
export async function kycGstAction(tenantId: string, gstNumber: unknown): Promise<KycResult> {
  const who = await owner(tenantId);
  return who && !off() ? checkGst(who.token, tenantId, gstNumber) : forbidden;
}
export async function kycAadhaarAction(tenantId: string): Promise<KycResult<{ url: string }>> {
  const who = await owner(tenantId);
  return who && !off() ? startAadhaar(who.token, tenantId) : forbidden;
}
export async function kycSubmitAction(tenantId: string): Promise<KycResult> {
  const who = await owner(tenantId);
  const out = who && !off() ? await submitAll(who.token, tenantId) : forbidden;
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/phone-number`);
  return out;
}
