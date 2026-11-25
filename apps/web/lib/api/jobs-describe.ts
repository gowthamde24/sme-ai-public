import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, readRows, rec, str } from "./shape";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/types";
import { TELL_TEXT_MAX, TELL_TEXT_MIN, mockDraft, type TellDraft, type TellField, type TellMode } from "@/lib/jobs/tell";
import { tellScreens } from "@/lib/screens/flag";

/**
 * `POST /v1/tenants/{t}/jobs/describe` (C1, docs/contracts/jobs-describe.md; Owner and Admin; behind JOBS): the owner's sentence in, a DRAFT out. SERVER ONLY, with the person's own token. Nothing is created or switched on and the sentence is not stored by
 * the API. 429 `ai_limit` (30 a day), 503 `describe_unavailable` and 422 are refusals the action puts in plain words. With TELL_SCREENS=mock nothing is sent: `mockDraft` answers. The draft is parsed strictly: a kind or key that is not a closed word is dropped.
 */
const CLOSED = /^[a-z][a-z0-9_]{0,60}$/;
const base = (tenantId: string): string => (isCanonicalUuid(tenantId) ? `/v1/tenants/${tenantId}/jobs` : bad("tenant id"));

function parseField(row: unknown): TellField {
  const x = rec(row, "field");
  const key = str(x.key, "key", 61);
  if (!CLOSED.test(key)) bad("key");
  const value = x.value;
  if (typeof value !== "boolean" && !(typeof value === "string" && value.length <= 40 && /^[A-Za-z0-9_:.-]+$/.test(value))) bad("value");
  return { key, value, words: typeof x.words === "string" ? x.words.slice(0, 200) : "" };
}
const closedList = (v: unknown, what: string, max: number): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && CLOSED.test(k)).slice(0, max) : bad(what));

export function parseDraft(json: unknown): TellDraft {
  const x = rec(json, "draft");
  const understood = bool(x.understood, "understood");
  const kind = typeof x.kind === "string" && (JOB_KINDS as readonly string[]).includes(x.kind) ? (x.kind as JobKind) : null;
  const fields = understood && kind ? readRows(x.fields, "fields", parseField, 20) : [];
  const line = typeof x.unclear_words === "string" && x.unclear_words.length <= 300 ? x.unclear_words : null;
  return {
    understood: understood && kind !== null,
    templateId: typeof x.template_id === "string" && CLOSED.test(x.template_id) ? x.template_id : null,
    kind,
    goal: typeof x.goal === "string" && CLOSED.test(x.goal) ? x.goal : null,
    fields,
    unclear: closedList(x.unclear, "unclear", 20),
    nearest: closedList(x.nearest, "nearest", 3),
    unclearWords: line,
  };
}

/** What may be asked: 3 to 1000 characters, one of the four languages, typed or voice (the transcript of the app's recogniser). */
export function checkDescribeInput(input: { text: string; language: string; source: string }): { text: string; language: "en" | "te" | "hi" | "kn"; source: "typed" | "voice" } {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < TELL_TEXT_MIN || text.length > TELL_TEXT_MAX) throw new ApiContractError("text");
  if (!["en", "te", "hi", "kn"].includes(input.language)) throw new ApiContractError("language");
  if (input.source !== "typed" && input.source !== "voice") throw new ApiContractError("source");
  return { text, language: input.language as "en" | "te" | "hi" | "kn", source: input.source };
}

export async function describeJob(token: string, tenantId: string, input: { text: string; language: "en" | "te" | "hi" | "kn"; source: "typed" | "voice" }, mode: TellMode | null): Promise<TellDraft> {
  const body = checkDescribeInput(input);
  if (tellScreens() === "mock") return mockDraft(body.text, mode);
  return parseDraft(await apiRequest(`${base(tenantId)}/describe`, token, { method: "POST", body: JSON.stringify(body) }));
}
