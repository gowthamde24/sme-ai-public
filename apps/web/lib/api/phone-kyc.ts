import { DOC_KINDS, FILE_TYPES, KYC_STATES, type KycBody, type KycDocOption, type KycOptions, type KycStatus } from "@/lib/phone-kyc/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, nstr, oneOf, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * The registration (KYC) of the business's phone number, from C1's API (services/ai-api/app/phone_kyc; owner decision 14 Nov 2026). SERVER ONLY, with the person's own token (a browser never holds it).
 *   GET  /options   Owner, Admin   the documents (one of three is enough), their number labels, the file rules
 *   GET  ""         any member     where the registration stands (`reason` = the phone company's own words, Owner and Admin only)
 *   POST ""         Owner + second factor   file it. The document is in the request body as base64 and passes through in memory only: nothing here logs, keeps or copies it.
 * Every state and kind is a closed word read through lib/api/shape.ts; a value outside the contract is an ApiContractError, never drawn.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/phone-kyc`;
};

export function parseKycStatus(json: unknown): KycStatus {
  const x = rec(json, "phone registration");
  const reason = optStr(x.reason, "reason", 1000);
  return {
    state: oneOf(x.state, KYC_STATES, "state"),
    kycId: x.kyc_id === null || x.kyc_id === undefined ? null : uuid(x.kyc_id, "kyc_id"),
    docKind: x.doc_kind === null || x.doc_kind === undefined ? null : oneOf(x.doc_kind, DOC_KINDS, "doc_kind"),
    complianceId: x.compliance_id === null || x.compliance_id === undefined ? null : word(x.compliance_id, "compliance_id", 80),
    reason: reason !== null && reason.trim() !== "" ? reason.trim() : null,
    createdAt: optIso(x.created_at, "created_at"),
    updatedAt: optIso(x.updated_at, "updated_at"),
    checkedAt: optIso(x.checked_at, "checked_at"),
    live: bool(x.live, "live"),
    canChooseNumber: bool(x.can_choose_number, "can_choose_number"),
  };
}

export function parseKycOptions(json: unknown): KycOptions {
  const x = rec(json, "phone registration options");
  const documents = list(x.documents, "documents", 10).map((row): KycDocOption => {
    const d = rec(row, "document");
    return { kind: oneOf(d.kind, DOC_KINDS, "kind"), numberLabel: nstr(d.number_label, "number_label", 80), numberExample: nstr(d.number_example, "number_example", 80) };
  });
  if (documents.length === 0) bad("documents");
  const fileTypes = list(x.file_types, "file_types", 10).map((t) => oneOf(t, FILE_TYPES, "file type"));
  if (fileTypes.length === 0) bad("file_types");
  return { live: bool(x.live, "live"), documents, maxFileBytes: int(x.max_file_bytes, "max_file_bytes", 1, 50_000_000), fileTypes, keptNote: str(x.kept_note ?? "", "kept_note", 300) };
}

export async function getKycStatus(accessToken: string, tenantId: string): Promise<KycStatus> {
  return parseKycStatus(await apiRequest(base(tenantId), accessToken));
}
export async function getKycOptions(accessToken: string, tenantId: string): Promise<KycOptions> {
  return parseKycOptions(await apiRequest(`${base(tenantId)}/options`, accessToken));
}
/** File the application. The body is sent as it is (the route has checked it); the answer is where the registration stands now. In test mode the API checks everything and answers `{state: "not_started", live: false}`. */
export async function submitKyc(accessToken: string, tenantId: string, body: KycBody): Promise<KycStatus> {
  return parseKycStatus(await apiRequest(base(tenantId), accessToken, { method: "POST", body: JSON.stringify(body) }));
}
