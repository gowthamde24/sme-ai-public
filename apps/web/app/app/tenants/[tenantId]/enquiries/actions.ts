"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CHANNELS,
  FIELD_KEYS,
  LINE_FIELD_KEYS,
  addField,
  captureEnquiry,
  confirmRequirement,
  decideField,
  discardRequirement,
  startRequirementRun,
  type Channel,
  type FieldKey,
} from "@/lib/api/enquiries";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";
import type { Say } from "@/components/v2/app/words";

export type EnquiryActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const MAX_TEXT = 200_000;
const MAX_SUBJECT = 2000;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording; nothing the API or the customer wrote is echoed. */
function describe(error: unknown, t: Say, materials = false): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return t("enq.write_roles");
    if (error.status === 404) return t("enq.this_record_is_not_available");
    switch (error.code) {
      case "requirement_confirmed":
        return t("enq.this_enquiry_already_has_an_approved");
      case "discard_draft_to_rerun":
        return t("enq.discard_the_current_draft_to_re");
      case "requirement_not_draft":
        return t("enq.this_requirement_is_no_longer_a");
      case "not_confirmable":
        return t(materials ? "mat.req.approve_a_product" : "enq.approve_a_saree_type_and_a");
      case "value_not_accepted":
        return t("enq.that_value_could_not_be_read");
      case "quote_not_found":
        return t("enq.that_quote_is_not_in_the");
      case "invalid_line":
        return t(materials ? "mat.req.line_fields" : "enq.saree_type_fabric_colour_and_quantity");
      case "invalid_value":
        return t("enq.that_field_already_has_a_value");
      case "empty_enquiry":
        return t("enq.there_is_no_text_left_to");
      case "received_in_future":
        return t("enq.an_enquiry_cannot_be_received_in");
      case "ai_paused_until":
        return t("enq.ai_help_is_paused_because_this");
      case "agents_disabled":
        return t("enq.agents_are_not_enabled_for_this");
      case "conflict":
        return t("enq.this_form_is_out_of_date");
    }
    if (error.status === 429) return t("enq.too_many_requests_try_again_later");
    if (error.status === 503) return t("enq.this_is_not_available_right_now");
    if (error.status === 409) return t("enq.that_is_not_possible_right_now");
    if (error.status === 422) return t("enq.that_input_was_not_accepted");
  }
  return t("enq.could_not_save_try_again");
}


/** Paste an enquiry onto a lead. The API strips invisible characters and removes contact details BEFORE storing; the original is kept nowhere. */
export async function captureEnquiryAction(
  tenantId: string,
  leadId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: t("enq.this_lead_is_not_available") };
  const id = trimmed(formData, "enquiry_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("enq.this_form_is_out_of_date") };
  const channel = trimmed(formData, "channel");
  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: t("enq.choose_where_the_enquiry_came_from") };
  const text = field(formData, "text");
  if (text.trim() === "") return { ok: false, error: t("enq.paste_the_enquiry_text") };
  if (text.length > MAX_TEXT) return { ok: false, error: t("enq.that_text_is_too_long_to") };
  const subject = trimmed(formData, "subject");
  if (subject.length > MAX_SUBJECT) return { ok: false, error: t("enq.that_subject_is_too_long") };
  const received = new Date(trimmed(formData, "received_at"));
  if (Number.isNaN(received.getTime())) return { ok: false, error: t("enq.say_when_the_enquiry_was_received") };

  let captured;
  try {
    captured = await captureEnquiry(user.accessToken, tenantId, leadId, {
      id,
      channel: channel as Channel,
      receivedAt: received.toISOString(),
      subject: subject === "" ? null : subject,
      text,
    });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}`);
  const notice = captured.truncated ? "truncated" : captured.text_changed ? "changed" : "stored";
  redirect(`/app/tenants/${tenantId}/enquiries/${captured.enquiry.id}?captured=${notice}`);
}

/** Ask the requirement agent to propose the fields (a run: it finishes on its own; reload the page to see its suggestions). */
export async function extractRequirementAction(
  tenantId: string,
  enquiryId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: t("enq.this_enquiry_is_not_available") };
  const id = trimmed(formData, "run_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("enq.this_form_is_out_of_date") };
  try {
    await startRequirementRun(user.accessToken, tenantId, { id, enquiryId });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: t("enq.started_the_suggestions_appear_on_this") };
}

/** Confirm, correct or reject ONE field. A correction is written in the person's own words and read by the same rules as the agent's. */
export async function decideFieldAction(
  tenantId: string,
  enquiryId: string,
  fieldId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(fieldId))
    return { ok: false, error: t("enq.this_field_is_not_available") };
  const decision = trimmed(formData, "decision");
  let input;
  if (decision === "confirm" || decision === "reject") input = { decision } as const;
  else if (decision === "correct") {
    const value = trimmed(formData, "value");
    if (value === "") return { ok: false, error: t("enq.write_the_corrected_value") };
    if (value.length > 120) return { ok: false, error: t("enq.that_value_is_too_long") };
    input = { decision, value } as const;
  } else return { ok: false, error: t("enq.choose_confirm_correct_or_reject") };
  try {
    await decideField(user.accessToken, tenantId, fieldId, input);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: decision === "confirm" ? t("enq.done.approved") : decision === "reject" ? t("enq.done.rejected") : t("enq.done.corrected") };
}

/** Add a field the extraction missed. */
export async function addFieldAction(
  tenantId: string,
  enquiryId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq.", "mat."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: t("enq.this_enquiry_is_not_available") };
  const key = trimmed(formData, "field");
  if (!(FIELD_KEYS as readonly string[]).includes(key)) return { ok: false, error: t("enq.choose_a_field") };
  const fieldKey = key as FieldKey;
  const rawLine = trimmed(formData, "line");
  let line: number | null = null;
  if (LINE_FIELD_KEYS.includes(fieldKey)) {
    line = Number(rawLine);
    if (!Number.isInteger(line) || line < 1 || line > 5) return { ok: false, error: t("enq.choose_the_line_1_to_5") };
  }
  const value = trimmed(formData, "value");
  if (value === "" || value.length > 120) return { ok: false, error: t("enq.write_the_value_in_at_most") };
  const quote = trimmed(formData, "quote");
  if (quote.length > 300) return { ok: false, error: t("enq.that_quote_is_too_long_at") };
  try {
    await addField(user.accessToken, tenantId, enquiryId, { line, field: fieldKey, value, quote: quote === "" ? null : quote });
  } catch (error) {
    return { ok: false, error: describe(error, t, hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: t("enq.added_and_approved") };
}

export async function confirmRequirementAction(
  tenantId: string,
  enquiryId: string,
  requirementId: string,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq.", "mat."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(requirementId))
    return { ok: false, error: t("enq.this_requirement_is_not_available") };
  try {
    await confirmRequirement(user.accessToken, tenantId, requirementId);
  } catch (error) {
    return { ok: false, error: describe(error, t, hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: t("enq.approved_nothing_was_sent_to_anyone") };
}

export async function discardRequirementAction(
  tenantId: string,
  enquiryId: string,
  requirementId: string,
): Promise<EnquiryActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(requirementId))
    return { ok: false, error: t("enq.this_requirement_is_not_available") };
  try {
    await discardRequirement(user.accessToken, tenantId, requirementId);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: t("enq.done.discarded") };
}
