"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  CUSTOMER_KINDS,
  REJECT_CODES,
  SALE_UNITS,
  WITHDRAW_CODES,
  approveQuote,
  createQuote,
  pickProduct,
  rejectQuote,
  withdrawQuote,
  type CustomerKind,
  type RejectCode,
  type SaleUnit,
  type WithdrawCode,
} from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import type { EnquiryActionState } from "./actions";
import { serverT } from "@/i18n/server-t";
import type { Say } from "@/components/v2/app/words";

export type QuoteActionState = EnquiryActionState;

const STATE_CODE = /^[A-Z]{2}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the customer wrote is echoed. */
function describe(error: unknown, t: Say): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    // the second factor and the owner-only rule are checked BEFORE the plain "your role does not allow this"
    if (error.code === "mfa_required")
      return t("enq.this_needs_your_authenticator_app_set");
    if (error.code === "owner_approval_required") return t("enq.this_quote_has_a_flag_that");
    if (error.status === 403) return t("enq.your_role_does_not_allow_this");
    if (error.status === 404) return t("enq.this_quote_is_not_available");
    switch (error.code) {
      case "quote_stale":
        return t("enq.a_price_list_a_policy_a");
      case "quote_mismatch":
        return t("enq.this_draft_no_longer_matches_what");
      case "quote_input_missing":
        return t("enq.pick_a_product_for_every_approved");
      case "quote_not_draft":
        return t("enq.this_quote_is_not_a_draft");
      case "quote_not_approved":
        return t("enq.only_an_approved_quote_can_be");
      case "requirement_not_confirmed":
        return t("enq.missing.requirement_not_confirmed");
      case "suggestion_changed":
        return t("enq.the_suggestion_changed_reload_the_page");
      case "invalid_delivery_state":
        return t("enq.choose_the_delivery_state_from_the");
      case "quote_not_computable":
        return t("enq.a_quote_cannot_be_made_from");
      case "quote_computation_unavailable":
        return t("enq.quotes_are_not_available_right_now");
      case "invalid_value":
      case "invalid_reference":
        return t("enq.that_product_or_quantity_was_not");
      case "conflict":
        return t("enq.this_form_is_out_of_date");
    }
    if (error.status === 503) return t("enq.quotes_are_not_available_right_now");
    if (error.status === 409) return t("enq.that_is_not_possible_right_now");
    if (error.status === 422) return t("enq.that_input_was_not_accepted");
  }
  return t("enq.could_not_save_try_again");
}

const page = (tenantId: string, enquiryId: string) => `/app/tenants/${tenantId}/enquiries/${enquiryId}`;

/**
 * A person says which product a requirement line means. The choice arrives as "source:product:unit" (source is "suggested" for a candidate the
 * mapper offered, "list" for any other product on the price list); the SERVER (our API) re-checks that a suggested pick is still suggested and
 * records its own provenance. The quantity is the person's: the database refuses one that changes the customer's own.
 */
export async function pickProductAction(
  tenantId: string,
  enquiryId: string,
  line: number,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !Number.isInteger(line) || line < 1 || line > 5)
    return { ok: false, error: t("enq.this_line_is_not_available") };
  const parts = trimmed(formData, "choice").split(":");
  if (parts.length !== 3) return { ok: false, error: t("enq.choose_a_product_2") };
  const [source, productId, unit] = parts;
  if ((source !== "suggested" && source !== "list") || !isCanonicalUuid(productId) || !(SALE_UNITS as readonly string[]).includes(unit))
    return { ok: false, error: t("enq.choose_a_product_2") };
  const rawQty = trimmed(formData, "qty");
  const qty = Number(rawQty);
  if (!/^\d{1,5}$/.test(rawQty) || !Number.isInteger(qty) || qty < 1 || qty > 10000)
    return { ok: false, error: t("enq.the_quantity_must_be_a_whole") };
  try {
    await pickProduct(user.accessToken, tenantId, enquiryId, {
      line,
      productId,
      qty,
      saleUnit: unit as SaleUnit,
      fromSuggestion: source === "suggested",
    });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: `Line ${line}: product chosen.` };
}

/** Make a DRAFT quote. The figures come from the engine and are checked by the database; nothing is sent and nothing is approved. */
export async function createQuoteAction(
  tenantId: string,
  enquiryId: string,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: t("enq.this_enquiry_is_not_available") };
  const id = trimmed(formData, "quote_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("enq.this_form_is_out_of_date") };
  const kind = trimmed(formData, "customer_kind");
  if (!(CUSTOMER_KINDS as readonly string[]).includes(kind)) return { ok: false, error: t("enq.say_whether_this_is_a_new") };
  const state = trimmed(formData, "delivery_state");
  if (!STATE_CODE.test(state)) return { ok: false, error: t("enq.choose_the_delivery_state_from_the") };
  let quote;
  try {
    quote = await createQuote(user.accessToken, tenantId, enquiryId, { id, customerKind: kind as CustomerKind, deliveryState: state });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(page(tenantId, enquiryId));
  redirect(`${page(tenantId, enquiryId)}?quote=${quote.id}`);
}

/** Approve a draft (an owner or an admin with their authenticator app; a flagged quote only the owner). Approving sends NOTHING to anyone. */
export async function approveQuoteAction(tenantId: string, enquiryId: string, quoteId: string): Promise<QuoteActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("enq.this_quote_is_not_available") };
  try {
    await approveQuote(user.accessToken, tenantId, quoteId);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: t("enq.approved_the_text_below_is_ready") };
}

export async function rejectQuoteAction(
  tenantId: string,
  enquiryId: string,
  quoteId: string,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("enq.this_quote_is_not_available") };
  const code = trimmed(formData, "code");
  if (!(REJECT_CODES as readonly string[]).includes(code)) return { ok: false, error: t("enq.choose_a_reason") };
  try {
    await rejectQuote(user.accessToken, tenantId, quoteId, code as RejectCode);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: t("enq.done.rejected") };
}

/** Withdraw an APPROVED quote (an owner or an admin with their authenticator app). It is kept, marked Withdrawn, and cannot be approved again. */
export async function withdrawQuoteAction(
  tenantId: string,
  enquiryId: string,
  quoteId: string,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const t = await serverT(["enq."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("enq.this_quote_is_not_available") };
  const code = trimmed(formData, "code");
  if (!(WITHDRAW_CODES as readonly string[]).includes(code)) return { ok: false, error: t("enq.choose_a_reason") };
  try {
    await withdrawQuote(user.accessToken, tenantId, quoteId, code as WithdrawCode);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: t("enq.withdrawn_it_is_kept_in_the") };
}
