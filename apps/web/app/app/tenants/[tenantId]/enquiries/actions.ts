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

export type EnquiryActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const MAX_TEXT = 200_000;
const MAX_SUBJECT = 2000;
const WRITE_ROLES_MESSAGE = "Only an owner, admin or sales user can do this.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording; nothing the API or the customer wrote is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return WRITE_ROLES_MESSAGE;
    if (error.status === 404) return "This record is not available.";
    switch (error.code) {
      case "requirement_confirmed":
        return "This enquiry already has an approved requirement. Discard it first to change it.";
      case "discard_draft_to_rerun":
        return "Discard the current draft to re-run.";
      case "requirement_not_draft":
        return "This requirement is no longer a draft. Reload the page.";
      case "not_confirmable":
        return "Approve a saree type and a quantity for at least one line first.";
      case "value_not_accepted":
        return "That value could not be read, or is outside the limits. Write it the way the enquiry does, for example 20, next Friday, Rs 5k each.";
      case "quote_not_found":
        return "That quote is not in the enquiry text, word for word.";
      case "invalid_line":
        return "Saree type, fabric, colour and quantity need a line (1 to 5); the other fields have none.";
      case "invalid_value":
        return "That field already has a value on this requirement. Correct it instead.";
      case "empty_enquiry":
        return "There is no text left to store after cleaning it.";
      case "received_in_future":
        return "An enquiry cannot be received in the future.";
      case "ai_paused_until":
        return "AI help is paused because this workspace's AI allowance for the period is used up. Everything else keeps working. Try again later.";
      case "agents_disabled":
        return "Agents are not enabled for this workspace.";
      case "conflict":
        return "This form is out of date. Reload the page and try again.";
    }
    if (error.status === 429) return "Too many requests. Try again later.";
    if (error.status === 503) return "This is not available right now. Try again shortly.";
    if (error.status === 409) return "That is not possible right now. Reload the page and try again.";
    if (error.status === 422) return "That input was not accepted.";
  }
  return "Could not save. Try again.";
}

const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";

/** Paste an enquiry onto a lead. The API strips invisible characters and removes contact details BEFORE storing; the original is kept nowhere. */
export async function captureEnquiryAction(
  tenantId: string,
  leadId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: "This lead is not available." };
  const id = trimmed(formData, "enquiry_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const channel = trimmed(formData, "channel");
  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "Choose where the enquiry came from." };
  const text = field(formData, "text");
  if (text.trim() === "") return { ok: false, error: "Paste the enquiry text." };
  if (text.length > MAX_TEXT) return { ok: false, error: "That text is too long to paste." };
  const subject = trimmed(formData, "subject");
  if (subject.length > MAX_SUBJECT) return { ok: false, error: "That subject is too long." };
  const received = new Date(trimmed(formData, "received_at"));
  if (Number.isNaN(received.getTime())) return { ok: false, error: "Say when the enquiry was received." };

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
    return { ok: false, error: describe(error) };
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
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: "This enquiry is not available." };
  const id = trimmed(formData, "run_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  try {
    await startRequirementRun(user.accessToken, tenantId, { id, enquiryId });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: "Started. The suggestions appear on this page when the run is Completed: reload in a moment." };
}

/** Confirm, correct or reject ONE field. A correction is written in the person's own words and read by the same rules as the agent's. */
export async function decideFieldAction(
  tenantId: string,
  enquiryId: string,
  fieldId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(fieldId))
    return { ok: false, error: "This field is not available." };
  const decision = trimmed(formData, "decision");
  let input;
  if (decision === "confirm" || decision === "reject") input = { decision } as const;
  else if (decision === "correct") {
    const value = trimmed(formData, "value");
    if (value === "") return { ok: false, error: "Write the corrected value." };
    if (value.length > 120) return { ok: false, error: "That value is too long." };
    input = { decision, value } as const;
  } else return { ok: false, error: "Choose confirm, correct or reject." };
  try {
    await decideField(user.accessToken, tenantId, fieldId, input);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: decision === "confirm" ? "Approved." : decision === "reject" ? "Rejected." : "Corrected and approved." };
}

/** Add a field the extraction missed. */
export async function addFieldAction(
  tenantId: string,
  enquiryId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: "This enquiry is not available." };
  const key = trimmed(formData, "field");
  if (!(FIELD_KEYS as readonly string[]).includes(key)) return { ok: false, error: "Choose a field." };
  const fieldKey = key as FieldKey;
  const rawLine = trimmed(formData, "line");
  let line: number | null = null;
  if (LINE_FIELD_KEYS.includes(fieldKey)) {
    line = Number(rawLine);
    if (!Number.isInteger(line) || line < 1 || line > 5) return { ok: false, error: "Choose the line (1 to 5)." };
  }
  const value = trimmed(formData, "value");
  if (value === "" || value.length > 120) return { ok: false, error: "Write the value, in at most 120 characters." };
  const quote = trimmed(formData, "quote");
  if (quote.length > 300) return { ok: false, error: "That quote is too long (at most 300 characters)." };
  try {
    await addField(user.accessToken, tenantId, enquiryId, { line, field: fieldKey, value, quote: quote === "" ? null : quote });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: "Added and approved." };
}

export async function confirmRequirementAction(
  tenantId: string,
  enquiryId: string,
  requirementId: string,
): Promise<EnquiryActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(requirementId))
    return { ok: false, error: "This requirement is not available." };
  try {
    await confirmRequirement(user.accessToken, tenantId, requirementId);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: "Approved. Nothing was sent to anyone." };
}

export async function discardRequirementAction(
  tenantId: string,
  enquiryId: string,
  requirementId: string,
): Promise<EnquiryActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(requirementId))
    return { ok: false, error: "This requirement is not available." };
  try {
    await discardRequirement(user.accessToken, tenantId, requirementId);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  return { ok: true, message: "Discarded." };
}
