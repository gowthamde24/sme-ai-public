import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseContext, parseTest, parseUnderstood, parseVersions, type ContextError, type ContextState, type TestAnswer, type Understood, type UnderstandKind, type VersionItem } from "@/lib/context/types";

/**
 * The assistant's notes from C1's API (contract-context-sources.md part A), under `/v1/tenants/{id}/ai-assistant`, the signed-in person's own token, SERVER SIDE ONLY:
 *   GET/PUT /context (+ expected_version: 409 context_changed when someone saved first) · GET /context/versions, GET .../versions/{v}, POST .../versions/{v}/restore
 *   POST /context/understand {kind: paste|file|voice, ...} -> a PREVIEW (nothing saved) · POST /context/understand/{preview_id}/save {notes_markdown, mode, expected_version}
 *   POST /context/test {question, language}
 * Schools: 422 `not_for_schools` with a `reason` (fees, marks, dues, children). Read = any member; write = Owner and Admin.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-assistant/context`;
};
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** An API refusal as a closed word. */
export function contextErrorOf(error: unknown): ContextError {
  if (!(error instanceof ApiRequestError)) return "down";
  const reason = error.reason;
  switch (error.code) {
    case "context_changed":
      return "changed";
    case "preview_expired":
      return "expired";
    case "not_for_schools":
      return reason === "marks" ? "schools_marks" : reason === "dues" ? "schools_dues" : reason === "children" ? "schools_children" : "schools_fees";
    case "sheet_refused":
    case "file_unreadable":
      return error.code === "sheet_refused" ? "refused" : "unreadable";
    case "file_too_large":
      return "toolarge";
    case "model_unavailable":
      return "busy";
    case "rate_limited":
      return "slow";
    default:
      return error.status === 403 ? "forbidden" : error.status === 410 ? "expired" : "down";
  }
}

const need = <T>(v: T | null): T => {
  if (v === null) throw new ApiContractError("Unexpected notes response.");
  return v;
};

export const getContext = async (token: string, tenantId: string): Promise<ContextState> => need(parseContext(await apiRequest(base(tenantId), token)));
export const putContext = async (token: string, tenantId: string, notes: string, expectedVersion: number): Promise<ContextState> => need(parseContext(await apiRequest(base(tenantId), token, { method: "PUT", body: JSON.stringify({ notes, expected_version: expectedVersion }) })));
export const getVersions = async (token: string, tenantId: string): Promise<VersionItem[]> => need(parseVersions(await apiRequest(`${base(tenantId)}/versions?limit=20`, token)));
export async function getVersionText(token: string, tenantId: string, version: number): Promise<string> {
  const json = await apiRequest(`${base(tenantId)}/versions/${Math.trunc(version)}`, token);
  const notes = typeof json === "object" && json !== null ? (json as { notes?: unknown; text?: unknown }).notes ?? (json as { text?: unknown }).text : null;
  if (typeof notes !== "string") throw new ApiContractError("Unexpected version.");
  return notes;
}
export const restoreVersion = async (token: string, tenantId: string, version: number): Promise<ContextState> => need(parseContext(await apiRequest(`${base(tenantId)}/versions/${Math.trunc(version)}/restore`, token, post({}))));
export type UnderstandInput = { kind: UnderstandKind; text?: string; filename?: string; contentBase64?: string; language?: string };
export const understand = async (token: string, tenantId: string, i: UnderstandInput): Promise<Understood> => need(parseUnderstood(await apiRequest(`${base(tenantId)}/understand`, token, post({ kind: i.kind, text: i.text, filename: i.filename, content_base64: i.contentBase64, language: i.language }))));
export const saveUnderstood = async (token: string, tenantId: string, previewId: string, notesMarkdown: string, mode: "append" | "replace", expectedVersion: number): Promise<ContextState> => {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(previewId)) throw new ApiContractError("id");
  return need(parseContext(await apiRequest(`${base(tenantId)}/understand/${previewId}/save`, token, post({ notes_markdown: notesMarkdown, mode, expected_version: expectedVersion }))));
};
export const testContext = async (token: string, tenantId: string, question: string, language?: string): Promise<TestAnswer> => need(parseTest(await apiRequest(`${base(tenantId)}/test`, token, post({ question: question.slice(0, 500), ...(language ? { language } : {}) }))));
