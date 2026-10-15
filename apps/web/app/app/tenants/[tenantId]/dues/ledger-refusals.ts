import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

/** Why a ledger step was refused, as ONE sentence of OUR wording chosen by the API's closed status and code (jobs CO, CS). Nothing from the server's text is shown. A rejected session is thrown again. */
export type LedgerRefusal = { key: string; mfa?: boolean };
const BY_CODE: Record<string, LedgerRefusal> = {
  mfa_required: { key: "today.err.mfa", mfa: true },
  forbidden: { key: "today.err.role" },
  invoice_number_used: { key: "due.err.invoiceused" },
  already_voided: { key: "due.err.voided" },
  dues_unavailable: { key: "due.err.unavailable" },
  module_off: { key: "mat.err.moduleoff" },
  validation_error: { key: "due.err.invalid" },
  invalid_reference: { key: "due.err.invalid" },
  not_found: { key: "due.err.notfound" },
  conflict: { key: "due.err.invalid" },
};
export function ledgerRefusalOf(error: unknown): LedgerRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404) return { key: "due.err.notfound" };
    if (error.status === 503) return { key: "due.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
