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

export type QuoteActionState = EnquiryActionState;

const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
const STATE_CODE = /^[A-Z]{2}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the customer wrote is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    // the second factor and the owner-only rule are checked BEFORE the plain "your role does not allow this"
    if (error.code === "mfa_required")
      return "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.";
    if (error.code === "owner_approval_required") return "This quote has a flag that only the owner can approve.";
    if (error.status === 403) return "Your role does not allow this.";
    if (error.status === 404) return "This quote is not available.";
    switch (error.code) {
      case "quote_stale":
        return "A price list, a policy, a product pick or the requirement changed since this draft, or the draft expired. Make a new draft.";
      case "quote_mismatch":
        return "This draft no longer matches what it was made from. Make a new draft.";
      case "quote_input_missing":
        return "Pick a product for every approved line, and say where it is delivered, before making a quote.";
      case "quote_not_draft":
        return "This quote is not a draft any more. Reload the page.";
      case "quote_not_approved":
        return "Only an approved quote can be withdrawn.";
      case "requirement_not_confirmed":
        return "Approve the requirement first.";
      case "suggestion_changed":
        return "The suggestion changed. Reload the page and pick again.";
      case "invalid_delivery_state":
        return "Choose the delivery state from the list.";
      case "quote_not_computable":
        return "A quote cannot be made from these inputs. Check that every approved line has a product and a quantity.";
      case "quote_computation_unavailable":
        return "Quotes are not available right now. Try again shortly.";
      case "invalid_value":
      case "invalid_reference":
        return "That product or quantity was not accepted. The quantity must be the enquiry's, unless the unit differs: then enter the converted count.";
      case "conflict":
        return OUT_OF_DATE;
    }
    if (error.status === 503) return "Quotes are not available right now. Try again shortly.";
    if (error.status === 409) return "That is not possible right now. Reload the page and try again.";
    if (error.status === 422) return "That input was not accepted.";
  }
  return "Could not save. Try again.";
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
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !Number.isInteger(line) || line < 1 || line > 5)
    return { ok: false, error: "This line is not available." };
  const parts = trimmed(formData, "choice").split(":");
  if (parts.length !== 3) return { ok: false, error: "Choose a product." };
  const [source, productId, unit] = parts;
  if ((source !== "suggested" && source !== "list") || !isCanonicalUuid(productId) || !(SALE_UNITS as readonly string[]).includes(unit))
    return { ok: false, error: "Choose a product." };
  const rawQty = trimmed(formData, "qty");
  const qty = Number(rawQty);
  if (!/^\d{1,5}$/.test(rawQty) || !Number.isInteger(qty) || qty < 1 || qty > 10000)
    return { ok: false, error: "The quantity must be a whole number from 1 to 10,000." };
  try {
    await pickProduct(user.accessToken, tenantId, enquiryId, {
      line,
      productId,
      qty,
      saleUnit: unit as SaleUnit,
      fromSuggestion: source === "suggested",
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
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
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: "This enquiry is not available." };
  const id = trimmed(formData, "quote_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const kind = trimmed(formData, "customer_kind");
  if (!(CUSTOMER_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Say whether this is a new or a repeat customer." };
  const state = trimmed(formData, "delivery_state");
  if (!STATE_CODE.test(state)) return { ok: false, error: "Choose the delivery state from the list." };
  let quote;
  try {
    quote = await createQuote(user.accessToken, tenantId, enquiryId, { id, customerKind: kind as CustomerKind, deliveryState: state });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(page(tenantId, enquiryId));
  redirect(`${page(tenantId, enquiryId)}?quote=${quote.id}`);
}

/** Approve a draft (an owner or an admin with their authenticator app; a flagged quote only the owner). Approving sends NOTHING to anyone. */
export async function approveQuoteAction(tenantId: string, enquiryId: string, quoteId: string): Promise<QuoteActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: "This quote is not available." };
  try {
    await approveQuote(user.accessToken, tenantId, quoteId);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: "Approved. The text below is ready to copy. Nothing was sent to anyone." };
}

export async function rejectQuoteAction(
  tenantId: string,
  enquiryId: string,
  quoteId: string,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: "This quote is not available." };
  const code = trimmed(formData, "code");
  if (!(REJECT_CODES as readonly string[]).includes(code)) return { ok: false, error: "Choose a reason." };
  try {
    await rejectQuote(user.accessToken, tenantId, quoteId, code as RejectCode);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: "Rejected." };
}

/** Withdraw an APPROVED quote (an owner or an admin with their authenticator app). It is kept, marked Withdrawn, and cannot be approved again. */
export async function withdrawQuoteAction(
  tenantId: string,
  enquiryId: string,
  quoteId: string,
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: "This quote is not available." };
  const code = trimmed(formData, "code");
  if (!(WITHDRAW_CODES as readonly string[]).includes(code)) return { ok: false, error: "Choose a reason." };
  try {
    await withdrawQuote(user.accessToken, tenantId, quoteId, code as WithdrawCode);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(page(tenantId, enquiryId));
  return { ok: true, message: "Withdrawn. It is kept in the history and can no longer be approved." };
}
