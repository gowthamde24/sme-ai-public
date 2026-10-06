"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { commitPriceList, previewPriceList, type Preview } from "@/lib/api/pricelists";
import { formatDate } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

export type PreviewState = { ok?: boolean; error?: string; preview?: Preview } | undefined;
export type CommitState = { ok?: boolean; error?: string; message?: string } | undefined;

const MAX_CHARS = 2 * 1024 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the file said is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required")
      return "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.";
    if (error.status === 403) return "Only an owner or an admin can load a price list.";
    if (error.status === 404) return "This workspace is not available.";
    switch (error.code) {
      case "price_list_invalid":
        return "The file has problems. Check it first to see them: nothing was saved.";
      case "conflict":
        return "This form is out of date or the file changed under the same attempt. Reload the page and try again.";
      case "invalid_value":
        return "The database did not accept this price list. A price list cannot be dated before the latest one.";
      case "invalid_reference":
        return "A product of the file is no longer in your catalog. Check the file again.";
      case "price_csv_unavailable":
      case "price_lists_unavailable":
        return "Price lists are not available right now. Try again shortly.";
    }
    if (error.status === 503) return "Price lists are not available right now. Try again shortly.";
    if (error.status === 422) return "That input was not accepted. Check the date and that the file is not empty.";
  }
  return "Could not do that. Try again.";
}

function inputs(formData: FormData): { csv: string; effectiveFrom: string } | string {
  const csv = field(formData, "csv");
  if (csv.trim() === "") return "Paste the file's text or choose a file first.";
  if (csv.length > MAX_CHARS) return "The file is too big: at most 2 MB.";
  const effectiveFrom = field(formData, "effective_from").trim();
  if (!DAY.test(effectiveFrom)) return "Choose the date the price list starts.";
  return { csv, effectiveFrom };
}

/** Check a file. Nothing is written; the result is the table of what the file would become and its issues. */
export async function previewPriceListAction(tenantId: string, _prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "This workspace is not available." };
  const given = inputs(formData);
  if (typeof given === "string") return { ok: false, error: given };
  try {
    return { ok: true, preview: await previewPriceList(user.accessToken, tenantId, given) };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Make the price list VERSION from the file (an owner or an admin with their authenticator app). The version's id is made by the page for each CHECK, so a double click is a retry (it replays) and
 * a new check is a new version. The API parses the file again. Nothing is sent to anyone.
 */
export async function commitPriceListAction(tenantId: string, _prev: CommitState, formData: FormData): Promise<CommitState> {
  const user = await requireUser();
  const versionId = field(formData, "version_id").trim();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(versionId)) return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const given = inputs(formData);
  if (typeof given === "string") return { ok: false, error: given };
  let done;
  try {
    done = await commitPriceList(user.accessToken, tenantId, { id: versionId, ...given });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/price-list`);
  return {
    ok: true,
    message: `${done.replayed ? "Already saved: " : "Saved: "}price list version ${done.version_no} with ${done.item_count} products, in force from ${formatDate(done.effective_from)}. Nothing was sent to anyone.`,
  };
}
