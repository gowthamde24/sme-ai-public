"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { FILE_TOO_BIG, MAX_FILE_BYTES, commitPriceList, previewPriceList, textBytes, type Preview } from "@/lib/api/pricelists";
import { formatDate } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

export type PreviewState = { ok?: boolean; error?: string; preview?: Preview } | undefined;
export type CommitState = { ok?: boolean; error?: string; message?: string } | undefined;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the file said is echoed. */
function describe(error: unknown, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required")
      return t("pl.this_needs_your_authenticator_app_set");
    if (error.status === 403) return t("pl.only_an_owner_or_an_admin");
    if (error.status === 404) return t("pl.this_workspace_is_not_available");
    switch (error.code) {
      case "price_list_invalid":
        return t("pl.the_file_has_problems_check_it");
      case "conflict":
        return t("pl.this_form_is_out_of_date");
      case "invalid_value":
        return t("pl.the_database_did_not_accept_this");
      case "invalid_reference":
        return t("pl.a_product_of_the_file_is");
      case "price_csv_unavailable":
      case "price_lists_unavailable":
        return t("pl.price_lists_are_not_available_right");
    }
    if (error.status === 503) return t("pl.price_lists_are_not_available_right");
    if (error.status === 422) return t("pl.that_input_was_not_accepted_check");
  }
  return t("pl.could_not_do_that_try_again");
}

function inputs(formData: FormData, t: Say = makeT()): { csv: string; effectiveFrom: string } | string {
  const csv = field(formData, "csv");
  if (csv.trim() === "") return t("pl.paste_the_file_s_text_or");
  if (csv.length > MAX_FILE_BYTES || textBytes(csv) > MAX_FILE_BYTES) return FILE_TOO_BIG; // bytes, not characters
  const effectiveFrom = field(formData, "effective_from").trim();
  if (!DAY.test(effectiveFrom)) return t("pl.choose_the_date_the_price_list");
  return { csv, effectiveFrom };
}

/** Check a file. Nothing is written; the result is the table of what the file would become and its issues. */
export async function previewPriceListAction(tenantId: string, _prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const t = await serverT(["pl."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("pl.this_workspace_is_not_available") };
  const given = inputs(formData, t);
  if (typeof given === "string") return { ok: false, error: given };
  try {
    return { ok: true, preview: await previewPriceList(user.accessToken, tenantId, given) };
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
}

/**
 * Make the price list VERSION from the file (an owner or an admin with their authenticator app). The version's id is made by the page for each CHECK, so a double click is a retry (it replays) and
 * a new check is a new version. The API parses the file again. Nothing is sent to anyone.
 */
export async function commitPriceListAction(tenantId: string, _prev: CommitState, formData: FormData): Promise<CommitState> {
  const t = await serverT(["pl."]);
  const user = await requireUser();
  const versionId = field(formData, "version_id").trim();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(versionId)) return { ok: false, error: t("pl.this_form_is_out_of_date_2") };
  const given = inputs(formData, t);
  if (typeof given === "string") return { ok: false, error: given };
  let done;
  try {
    done = await commitPriceList(user.accessToken, tenantId, { id: versionId, ...given });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/price-list`);
  return {
    ok: true,
    message: `${done.replayed ? "Already saved: " : "Saved: "}price list version ${done.version_no} with ${done.item_count} products, in force from ${formatDate(done.effective_from)}. Nothing was sent to anyone.`,
  };
}
