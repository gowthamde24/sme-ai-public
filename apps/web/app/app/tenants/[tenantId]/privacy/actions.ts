"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  cancelErasure,
  confirmationPhrase,
  executeErasure,
  fetchErasureRequest,
  phraseMatches,
  requestErasure,
  type ErasureResultOut,
  type ErasureScope,
} from "@/lib/api/erasure";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

export type PrivacyActionState =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      result?: ErasureResultOut;
    }
  | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Short, generic messages only: a raw API body or a submitted value is never shown. */
function explain(error: unknown, whatFor: string, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return t(`prv.role_cannot.${whatFor}`);
    if (error.status === 404)
      return t("prv.this_workspace_or_record_is_not");
    if (error.status === 409 && error.code === "erasure_window_open")
      return t("prv.a_workspace_wide_erasure_can_only");
    if (error.status === 409 && error.code === "erasure_cancelled")
      return t("prv.that_request_was_cancelled_make_a");
    if (error.status === 409 && error.code === "erasure_already_executed")
      return t("prv.that_erasure_has_already_been_carried");
    if (error.status === 409 && error.code === "erasure_owner_transfer_first")
      return t("prv.this_contact_is_the_workspace_s");
    if (error.status === 409 && error.code === "erasure_not_pending")
      return t("prv.that_request_is_no_longer_waiting");
    if (error.status === 409)
      return t("prv.this_form_is_out_of_date");
    if (error.status === 422) return t("prv.choose_who_or_what_to_erase");
    if (error.status === 503)
      return t("prv.erasure_is_not_available_right_now");
  }
  return t(`prv.could_not.${whatFor}`);
}

const SCOPES: readonly ErasureScope[] = ["contact", "company", "tenant"];

/** Owner or Admin asks. Nothing is erased by asking: the Owner runs the request from the list below. */
export async function requestErasureAction(
  tenantId: string,
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const t = await serverT(["prv."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId))
    return { ok: false, error: t("prv.this_workspace_is_not_available") };
  const requestId = field(formData, "request_id");
  if (!isCanonicalUuid(requestId))
    return {
      ok: false,
      error: t("prv.this_form_is_out_of_date"),
    };
  const scope = field(formData, "scope") as ErasureScope;
  if (!SCOPES.includes(scope))
    return { ok: false, error: t("prv.choose_what_to_erase") };
  const subjectId =
    scope === "contact"
      ? field(formData, "contact_id")
      : scope === "company"
        ? field(formData, "company_id")
        : null;
  if (scope !== "tenant" && !isCanonicalUuid(subjectId ?? ""))
    return {
      ok: false,
      error: scope === "contact" ? t("prv.choose_a_contact") : t("prv.choose_a_company"),
    };
  try {
    await requestErasure(user.accessToken, tenantId, {
      id: requestId,
      scope,
      subjectId,
    });
  } catch (error) {
    return { ok: false, error: explain(error, "request_an_erasure", t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/privacy`);
  return {
    ok: true,
    message:
      scope === "tenant"
        ? t("prv.requested_the_owner_can_run_it")
        : t("prv.requested_nothing_is_erased_until_the"),
  };
}

/** Owner only (the API enforces it): shows what would change and changes nothing. */
export async function previewErasureAction(
  tenantId: string,
  requestId: string,
): Promise<PrivacyActionState> {
  const t = await serverT(["prv."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: t("prv.this_request_is_not_available") };
  try {
    const result = await executeErasure(
      user.accessToken,
      tenantId,
      requestId,
      true,
    );
    return { ok: true, message: t("prv.preview_only_nothing_was_changed"), result };
  } catch (error) {
    return { ok: false, error: explain(error, "preview_this_erasure", t) };
  }
}

/**
 * Owner only. Irreversible, so the Owner must type the words (ERASE plus the subject's name, or the workspace slug). The expected words
 * are derived here, from the API, never taken from the form.
 */
export async function executeErasureAction(
  tenantId: string,
  requestId: string,
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const t = await serverT(["prv."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: t("prv.this_request_is_not_available") };
  try {
    const request = await fetchErasureRequest(user.accessToken, tenantId, requestId);
    const phrase = await confirmationPhrase(user.accessToken, tenantId, request);
    if (!phraseMatches(field(formData, "confirm_text"), phrase))
      return { ok: false, error: t("prv.type_the_words_shown_exactly_to") };
    const result = await executeErasure(user.accessToken, tenantId, requestId, false);
    revalidatePath(`/app/tenants/${tenantId}/privacy`);
    return { ok: true, message: t("prv.done_the_personal_data_was_erased"), result };
  } catch (error) {
    return { ok: false, error: explain(error, "run_this_erasure", t) };
  }
}

export async function cancelErasureAction(
  tenantId: string,
  requestId: string,
): Promise<PrivacyActionState> {
  const t = await serverT(["prv."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: t("prv.this_request_is_not_available") };
  try {
    await cancelErasure(user.accessToken, tenantId, requestId);
  } catch (error) {
    return { ok: false, error: explain(error, "cancel_this_request", t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/privacy`);
  return { ok: true, message: t("prv.cancelled") };
}
