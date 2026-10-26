import { ApiContractError, apiRequest, apiUploadRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { MAX_BYTES, parseBatches, parsePreview, parseSent, type MarksBatch, type MarksKind, type MarksLang, type MarksPreview, type MarksSent } from "@/lib/marks/types";

/**
 * The school's marks and report-card messages from C1's API (job DP; contract-marks-messages.md). Server side only, with the signed-in person's own token. The request body of `preview` and `send` IS the file (the API reads
 * the raw bytes, like the spreadsheet imports); it is held in memory for that one request and never stored here or there. `send` needs the second factor (403 `mfa_required`) and carries the preview's SHA-256 and count so
 * that only the file that was shown can be sent.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/institution/marks-messages`;
};
const query = (o: Record<string, string>): string => new URLSearchParams(o).toString();

export async function previewMarks(token: string, tenantId: string, file: ArrayBuffer, contentType: string, p: { kind: MarksKind; language: MarksLang; term: string }): Promise<MarksPreview> {
  if (file.byteLength > MAX_BYTES) throw new ApiContractError("file too large");
  const out = parsePreview(await apiUploadRequest(`${base(tenantId)}/preview?${query({ kind: p.kind, language: p.language, ...(p.term ? { term: p.term } : {}) })}`, token, file, contentType));
  if (!out) throw new ApiContractError("Unexpected marks preview response.");
  return out;
}

export async function sendMarks(token: string, tenantId: string, file: ArrayBuffer, contentType: string, p: { kind: MarksKind; language: MarksLang; term: string; batchId: string; sha256: string; count: number }): Promise<MarksSent> {
  if (file.byteLength > MAX_BYTES || !isCanonicalUuid(p.batchId) || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new ApiContractError("bad send");
  const q = query({ kind: p.kind, language: p.language, ...(p.term ? { term: p.term } : {}), batch_id: p.batchId, expect_sha256: p.sha256, expect_count: String(p.count) });
  const out = parseSent(await apiUploadRequest(`${base(tenantId)}/send?${q}`, token, file, contentType));
  if (!out) throw new ApiContractError("Unexpected marks send response.");
  return out;
}

export async function listMarksBatches(token: string, tenantId: string): Promise<MarksBatch[]> {
  return parseBatches(await apiRequest(`${base(tenantId)}/batches?limit=10`, token));
}
