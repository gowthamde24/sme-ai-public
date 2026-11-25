import { ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, isRec, oneOf, optStr, rec, str } from "./shape";

/**
 * The business's own phone account (Model B; C1's docs/contracts/business-kyc.md; the API answers 404 unless KYC_PER_CLIENT is on). SERVER ONLY, with the person's own token. Identity numbers (PAN, GSTIN) and documents go to the API and are dropped there:
 * nothing here keeps, logs or returns them, and the API's own sentences never reach the screen (a closed `reason` gets a sentence of ours, `pick.kyc.err.*`). Aadhaar never touches us: the DigiLocker address opens on the person's own phone.
 *   GET  /phone-kyc/business            Owner, Admin   {state, account_type, step, steps, missing, reason, words}
 *   POST /phone-kyc/business/start      Owner          makes the business's own client (once; its e-mail is the signed-in Owner's)
 *   POST .../details | pan | gst | aadhaar | documents | submit      Owner
 */
export const KYC_STATES = ["not_started", "waiting_for_line", "created", "in_progress", "submitted", "verified", "stuck"] as const;
export type KycState = (typeof KYC_STATES)[number];
export const ACCOUNT_TYPES = ["individual", "business"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** The closed reasons of a refusal (`kyc_refused` / `kyc_unavailable`), each with a sentence of ours; a word outside the list reads as `refused`. */
export const KYC_REASONS = ["unavailable", "email_in_use", "pan_mismatch", "pan_invalid", "gst_invalid", "step_order", "file_unreadable", "file_too_big", "missing_documents", "refused", "not_started", "stuck"] as const;
export type KycReason = (typeof KYC_REASONS)[number];
export const DOC_TYPES = ["pan", "aadhaar", "gst"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type KycStatus = {
  state: KycState;
  accountType: AccountType | null;
  /** the step VoiceLink is on (`pan`, `aadhaar`, `gst`, `complete`), or null */
  step: string | null;
  /** which documents are uploaded */
  steps: Partial<Record<DocType, boolean>>;
  /** names of documents still missing after a submit (short plain names, at most 6) */
  missing: string[];
  reason: KycReason | null;
};

const base = (tenantId: string): string => (isCanonicalUuid(tenantId) ? `/v1/tenants/${tenantId}/phone-kyc/business` : bad("tenant id"));

const reasonOf = (v: unknown): KycReason | null => (typeof v === "string" ? ((KYC_REASONS as readonly string[]).includes(v) ? (v as KycReason) : "refused") : null);

export function parseStatus(json: unknown): KycStatus {
  const x = rec(json, "kyc");
  const steps: Partial<Record<DocType, boolean>> = {};
  if (isRec(x.steps)) for (const k of DOC_TYPES) if (typeof x.steps[k] === "boolean") steps[k] = x.steps[k] as boolean;
  const missing = Array.isArray(x.missing) ? x.missing.filter((m): m is string => typeof m === "string" && m.length > 0 && m.length <= 40).slice(0, 6) : [];
  const step = optStr(x.step, "step", 20);
  return {
    state: oneOf(x.state, KYC_STATES, "state"),
    accountType: x.account_type === null || x.account_type === undefined ? null : oneOf(x.account_type, ACCOUNT_TYPES, "account_type"),
    step: step !== null && /^[a-z]+$/.test(step) ? step : null,
    steps,
    missing,
    reason: reasonOf(x.reason),
  };
}
/** `422 kyc_fields_invalid` (business-kyc.md, 26 Nov 2026): each bad field of the form and its closed word (`mobile_invalid`, `pincode_invalid`, ...). Null for any other refusal. */
export function fieldReasons(error: unknown): Record<string, string> | null {
  if (error instanceof ApiRequestError && error.code === "city_not_found") return { city: "city_not_found" }; // (C1's name for the city the phone service does not know)
  return error instanceof ApiRequestError && error.code === "kyc_fields_invalid" && error.extra?.reasons ? error.extra.reasons : null;
}
/** A refusal's closed reason (`error.reason`, else the `fields` word the client keeps); `missing_documents` also carries the names of the documents. */
export function refusalReason(error: unknown): { reason: KycReason; missing: string[] } | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.code !== "kyc_refused" && error.code !== "kyc_unavailable" && error.status !== 409 && error.status !== 422 && error.status !== 503) return null;
  const word = error.reason ?? error.extra?.fields?.[0];
  return { reason: (KYC_REASONS as readonly string[]).includes(word ?? "") ? (word as KycReason) : error.code === "kyc_unavailable" ? "unavailable" : "refused", missing: [] };
}

export async function readKyc(token: string, tenantId: string): Promise<KycStatus> {
  return parseStatus(await apiRequest(base(tenantId), token));
}
const post = async (token: string, tenantId: string, tail: string, body: unknown): Promise<unknown> => apiRequest(`${base(tenantId)}/${tail}`, token, { method: "POST", body: JSON.stringify(body) });

export const kycStart = async (token: string, tenantId: string): Promise<KycStatus> => parseStatus(await post(token, tenantId, "start", {}));
export type KycDetails = { accountType: AccountType; businessName: string | null; fullName: string; phone: string; billingAddress: string; state: string | null; city: string | null; pincode: string | null };
export const kycDetails = async (token: string, tenantId: string, d: KycDetails): Promise<KycStatus> =>
  parseStatus(
    await post(token, tenantId, "details", {
      account_type: d.accountType,
      ...(d.businessName ? { business_name: d.businessName } : {}),
      full_name: d.fullName,
      phone: d.phone,
      billing_address: d.billingAddress,
      ...(d.state ? { state: d.state } : {}),
      ...(d.city ? { city: d.city } : {}),
      ...(d.pincode ? { pincode: d.pincode } : {}),
      accept_terms: true,
    }),
  );
export const kycPan = async (token: string, tenantId: string, panNumber: string, holderName: string): Promise<KycStatus> => parseStatus(await post(token, tenantId, "pan", { pan_number: panNumber, holder_name: holderName }));
export const kycGst = async (token: string, tenantId: string, gstNumber: string): Promise<KycStatus> => parseStatus(await post(token, tenantId, "gst", { gst_number: gstNumber }));
/** `{redirect_url}`: the DigiLocker address to open on the person's own phone. Only an https address is accepted. */
export async function kycAadhaar(token: string, tenantId: string): Promise<string> {
  const url = str(rec(await post(token, tenantId, "aadhaar", {}), "aadhaar").redirect_url, "redirect_url", 2000);
  if (!/^https:\/\//i.test(url)) bad("redirect_url");
  return url;
}
export const kycDocument = async (token: string, tenantId: string, type: DocType, contentType: string, base64: string): Promise<KycStatus> =>
  parseStatus(await post(token, tenantId, "documents", { document_type: oneOf(type, DOC_TYPES, "document_type"), content_type: oneOf(contentType, ["image/jpeg", "image/png", "application/pdf"] as const, "content_type"), content_base64: base64 }));
export const kycSubmit = async (token: string, tenantId: string): Promise<KycStatus> => parseStatus(await post(token, tenantId, "submit", {}));
