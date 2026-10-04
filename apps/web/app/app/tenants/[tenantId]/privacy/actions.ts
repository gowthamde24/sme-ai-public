"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  cancelErasure,
  executeErasure,
  requestErasure,
  type ErasureResultOut,
  type ErasureScope,
} from "@/lib/api/erasure";
import { requireUser } from "@/lib/auth/session";

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
function explain(error: unknown, whatFor: string): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return `Your role cannot ${whatFor}.`;
    if (error.status === 404)
      return "This workspace or record is not available.";
    if (error.status === 409 && error.code === "erasure_window_open")
      return "A workspace-wide erasure can only run 24 hours after it was requested.";
    if (error.status === 409 && error.code === "erasure_cancelled")
      return "That request was cancelled. Make a new one.";
    if (error.status === 409 && error.code === "erasure_already_executed")
      return "That erasure has already been carried out.";
    if (error.status === 409 && error.code === "erasure_not_pending")
      return "That request is no longer waiting. Reload the page.";
    if (error.status === 409)
      return "This form is out of date. Reload the page and try again.";
    if (error.status === 422) return "Choose who or what to erase.";
    if (error.status === 503)
      return "Erasure is not available right now. Try again later.";
  }
  return `Could not ${whatFor}. Try again.`;
}

const SCOPES: readonly ErasureScope[] = ["contact", "company", "tenant"];

/** Owner or Admin asks. Nothing is erased by asking: the Owner runs the request from the list below. */
export async function requestErasureAction(
  tenantId: string,
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId))
    return { ok: false, error: "This workspace is not available." };
  const requestId = field(formData, "request_id");
  if (!isCanonicalUuid(requestId))
    return {
      ok: false,
      error: "This form is out of date. Reload the page and try again.",
    };
  const scope = field(formData, "scope") as ErasureScope;
  if (!SCOPES.includes(scope))
    return { ok: false, error: "Choose what to erase." };
  const subjectId =
    scope === "contact"
      ? field(formData, "contact_id")
      : scope === "company"
        ? field(formData, "company_id")
        : null;
  if (scope !== "tenant" && !isCanonicalUuid(subjectId ?? ""))
    return {
      ok: false,
      error: scope === "contact" ? "Choose a contact." : "Choose a company.",
    };
  try {
    await requestErasure(user.accessToken, tenantId, {
      id: requestId,
      scope,
      subjectId,
    });
  } catch (error) {
    return { ok: false, error: explain(error, "request an erasure") };
  }
  revalidatePath(`/app/tenants/${tenantId}/privacy`);
  return {
    ok: true,
    message:
      scope === "tenant"
        ? "Requested. The owner can run it 24 hours from now, and either of you can cancel it until then."
        : "Requested. Nothing is erased until the owner runs it from the list below.",
  };
}

/** Owner only (the API enforces it): shows what would change and changes nothing. */
export async function previewErasureAction(
  tenantId: string,
  requestId: string,
): Promise<PrivacyActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: "This request is not available." };
  try {
    const result = await executeErasure(
      user.accessToken,
      tenantId,
      requestId,
      true,
    );
    return { ok: true, message: "Preview only. Nothing was changed.", result };
  } catch (error) {
    return { ok: false, error: explain(error, "preview this erasure") };
  }
}

/** Owner only. Irreversible, so the form must carry the confirmation the Owner ticked. */
export async function executeErasureAction(
  tenantId: string,
  requestId: string,
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: "This request is not available." };
  if (field(formData, "confirm") !== "yes")
    return {
      ok: false,
      error: "Tick the box to confirm. This cannot be undone.",
    };
  try {
    const result = await executeErasure(
      user.accessToken,
      tenantId,
      requestId,
      false,
    );
    revalidatePath(`/app/tenants/${tenantId}/privacy`);
    return { ok: true, message: "Done. The personal data was erased.", result };
  } catch (error) {
    return { ok: false, error: explain(error, "run this erasure") };
  }
}

export async function cancelErasureAction(
  tenantId: string,
  requestId: string,
): Promise<PrivacyActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requestId))
    return { ok: false, error: "This request is not available." };
  try {
    await cancelErasure(user.accessToken, tenantId, requestId);
  } catch (error) {
    return { ok: false, error: explain(error, "cancel this request") };
  }
  revalidatePath(`/app/tenants/${tenantId}/privacy`);
  return { ok: true, message: "Cancelled." };
}
