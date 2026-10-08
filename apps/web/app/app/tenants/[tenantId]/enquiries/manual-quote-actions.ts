"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { CUSTOMER_KINDS, createManualQuote, type CustomerKind } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import { CHOOSE_KIND, EMPTY_LINE, MAX_LINES, OUT_OF_DATE, linesFromForm, type LineValues } from "./manual-quote-logic";

/**
 * What the form shows after a press: a sentence of OUR wording (never text from the API, the database or the customer). `blocked` means "pressing again cannot help"
 * (the enquiry already has a requirement of the line-by-line flow): the screen then stops offering the button instead of looping.
 */
export type ManualQuoteState = { ok?: boolean; error?: string; blocked?: boolean } | undefined;

const NO_RATE = "A quote with typed prices needs a quote policy in force with a GST rate that applies today.";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Every failure becomes a short sentence of OUR wording. */
function describe(error: unknown): ManualQuoteState {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "enquiry_has_requirement":
        return {
          ok: false,
          blocked: true,
          error:
            "This enquiry already has a requirement from the line-by-line flow, so a quote with typed prices cannot be made on it. Discard that requirement first (in the requirement section above), then reload this page.",
        };
      case "price_not_typed_by_person":
        return { ok: false, error: "Only a person can type a price." };
      case "quote_input_missing":
        return { ok: false, error: NO_RATE };
      case "invalid_reference":
        return { ok: false, error: "One of the item types is not available. Reload the page and choose again." };
      case "invalid_value":
        return { ok: false, error: "An item type that is no longer sold, or a value that is not allowed, was sent. Reload the page and choose again." };
      case "validation_error":
        return { ok: false, error: "A quantity, a price or a choice was not accepted. Check every line." };
      case "quote_mismatch":
        return { ok: false, error: "The draft did not match the database's own check, so nothing was saved. Reload the page and try again." };
      case "quote_stale":
        return { ok: false, error: "The quote policy changed while you were typing. Reload the page and try again." };
      case "conflict":
        return { ok: false, error: OUT_OF_DATE };
      case "forbidden":
        return { ok: false, error: "Only an owner or an admin can make a quote with typed prices." };
    }
    if (error.status === 403) return { ok: false, error: "Only an owner or an admin can make a quote with typed prices." };
    if (error.status === 404) return { ok: false, error: "This enquiry is not available." };
    if (error.status === 503 || error.status === 502) return { ok: false, error: "Quotes are not available right now. Try again shortly." };
    if (error.status === 409) return { ok: false, error: "That is not possible right now. Reload the page and try again." };
    if (error.status === 422) return { ok: false, error: "That input was not accepted." };
  }
  return { ok: false, error: "Could not save. Try again." };
}

const page = (tenantId: string, enquiryId: string) => `/app/tenants/${tenantId}/enquiries/${enquiryId}`;

/**
 * Make a DRAFT quote from prices a person typed (an owner or an admin). The server reads ONLY the quote id, the customer kind and the lines' item type, quantity and price (it never
 * reads or sends a delivery state); each price is converted to integer paise by reading the text, and the keys sent to the API are exactly the ones it allows. Nothing here
 * works out GST or a total: the API and the database do, and the database decides. The id comes from the page, so a retry replays instead of duplicating.
 */
export async function createManualQuoteAction(tenantId: string, enquiryId: string, _prev: ManualQuoteState, formData: FormData): Promise<ManualQuoteState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) return { ok: false, error: "This enquiry is not available." };
  const id = text(formData, "quote_id").trim();
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const kind = text(formData, "customer_kind").trim();
  if (!(CUSTOMER_KINDS as readonly string[]).includes(kind)) return { ok: false, error: CHOOSE_KIND };
  const count = Number(text(formData, "line_count"));
  if (!Number.isInteger(count) || count < 1 || count > MAX_LINES) return { ok: false, error: OUT_OF_DATE };
  const values: LineValues[] = [];
  for (let n = 1; n <= count; n += 1) {
    values.push({ ...EMPTY_LINE, code: text(formData, `code_${n}`), qty: text(formData, `qty_${n}`), price: text(formData, `price_${n}`) });
  }
  const lines = linesFromForm(values);
  if (!lines.ok) return { ok: false, error: lines.error };
  let quote;
  try {
    quote = await createManualQuote(user.accessToken, tenantId, enquiryId, {
      id,
      customerKind: kind as CustomerKind,
      deliveryState: null, // a quote with typed prices does not ask for it (the API still accepts one, the web just does not send it)
      lines: lines.lines,
    });
  } catch (error) {
    return describe(error);
  }
  revalidatePath(page(tenantId, enquiryId));
  redirect(`${page(tenantId, enquiryId)}?quote=${quote.id}`);
}
