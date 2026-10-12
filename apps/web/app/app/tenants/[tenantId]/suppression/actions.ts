"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { runBackfill } from "@/lib/api/suppression";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

/** What a backfill did, as counts. It never says the contacts are all keyed: only the status the page re-reads can say so. */
export type BackfillState =
  | { ok?: boolean; error?: string; recorded?: number; remaining?: number; unkeyable?: number }
  | undefined;

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required")
      return t("supp.this_needs_your_authenticator_app_set");
    if (error.status === 403) return t("supp.only_the_owner_can_record_suppression");
    if (error.status === 404) return t("supp.this_workspace_is_not_available");
    if (error.code === "suppression_key_not_configured" || error.status === 503)
      return t("supp.suppression_keys_are_not_available_right");
  }
  return t("supp.could_not_record_the_keys_try");
}

/** Owner with a second factor (the API enforces both; the database decides again). Takes nothing from the form: the keys are computed on the server for the caller's own workspace. */
export async function backfillKeysAction(tenantId: string): Promise<BackfillState> {
  const t = await serverT(["supp."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("supp.this_workspace_is_not_available") };
  try {
    const done = await runBackfill(user.accessToken, tenantId);
    revalidatePath(`/app/tenants/${tenantId}/suppression`);
    return { ok: true, recorded: done.recorded, remaining: done.remaining, unkeyable: done.unkeyable };
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
}
