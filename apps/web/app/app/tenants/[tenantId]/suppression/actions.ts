"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { runBackfill } from "@/lib/api/suppression";
import { requireUser } from "@/lib/auth/session";

/** What a backfill did, as counts. It never says the contacts are all keyed: only the status the page re-reads can say so. */
export type BackfillState =
  | { ok?: boolean; error?: string; recorded?: number; remaining?: number; unkeyable?: number }
  | undefined;

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required")
      return "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.";
    if (error.status === 403) return "Only the owner can record suppression keys.";
    if (error.status === 404) return "This workspace is not available.";
    if (error.code === "suppression_key_not_configured" || error.status === 503)
      return "Suppression keys are not available right now. Nothing was changed.";
  }
  return "Could not record the keys. Try again.";
}

/** Owner with a second factor (the API enforces both; the database decides again). Takes nothing from the form: the keys are computed on the server for the caller's own workspace. */
export async function backfillKeysAction(tenantId: string): Promise<BackfillState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "This workspace is not available." };
  try {
    const done = await runBackfill(user.accessToken, tenantId);
    revalidatePath(`/app/tenants/${tenantId}/suppression`);
    return { ok: true, recorded: done.recorded, remaining: done.remaining, unkeyable: done.unkeyable };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
