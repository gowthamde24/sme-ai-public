import { ApiContractError, apiRequest } from "./client";
import type { TestTone } from "@/lib/calls/test-call";
import { introduceToApi, parseIntroduceAs, type IntroduceAs } from "@/lib/talk-training/introduce";
import { isCanonicalUuid } from "./crm";

/**
 * Two calls of C1's Calls API (docs/contracts/calls.md; services/ai-api/app/telephony/routes.py), with the signed-in person's own token:
 *
 *   GET  /v1/tenants/{t}/calls/{id}          Owner, Admin, Sales: the call (who, the lead it belongs to, its short summary); the transcript is not read here
 *   POST /v1/tenants/{t}/calls/{id}/handled  Owner, Admin, Sales: a caller asked for a person and the team called back; the call leaves Today's "Needs you" (once; 404 for another workspace's call)
 */
const path = (tenantId: string, callId: string): string => {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/calls/${callId}`;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : null);

/** What the "asked for a person" card needs of a call: the lead to call back from (null: the call has none) and the call's own short summary (English, the API's; shown in English only). */
export type CallBrief = { leadId: string | null; gist: string | null; /** The visit time the caller agreed on the call (C1 #354: `captured.visit_at`, one of the times offered), ISO; null when none. */ visitAt: string | null };

export async function getCallBrief(token: string, tenantId: string, callId: string): Promise<CallBrief> {
  const json = await apiRequest(path(tenantId, callId), token);
  if (!isRecord(json) || json.id !== callId) throw new ApiContractError("Unexpected call body.");
  const at = isRecord(json.captured) ? json.captured.visit_at : null;
  return { leadId: typeof json.lead_id === "string" && isCanonicalUuid(json.lead_id) ? json.lead_id : null, gist: shortText(json.summary_short, 300), visitAt: typeof at === "string" && at.length <= 40 && !Number.isNaN(Date.parse(at)) ? at : null };
}

export async function markCallHandled(token: string, tenantId: string, callId: string): Promise<void> {
  await apiRequest(`${path(tenantId, callId)}/handled`, token, { method: "POST" });
}

/**
 * App v4 part 4: the Calls pages (docs/contracts/calls.md). `GET /calls` (live first, then finished, newest first; poll every `poll_after_s` while open), `GET /calls/{id}` (the summary, what was captured, the transcript for the Owner and
 * Admin only, the person's correction), `POST /calls/{id}/correction` ("Correct it": the AI's own summary and captured stay as they were) and `POST /calls/{id}/hang-up` (Owner, Admin). Checked field by field: a row that breaks the
 * contract is left out, never drawn wrong. The summary, the transcript and what was captured are personal data: shown to the people who may see them, never logged.
 */
export const CALL_STATES = ["queued", "ringing", "in_progress", "completed", "no_answer", "busy", "voicemail", "failed", "refused", "cancelled"] as const;
export type CallState = (typeof CALL_STATES)[number];
const OUTCOMES = ["positive", "negative", "unclear", "no_answer", "failed"] as const;
const CATEGORIES = ["interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later", "already_bought", "do_not_call"] as const;
export type CallRow = {
  id: string;
  direction: "outbound" | "inbound";
  state: CallState;
  live: boolean;
  who: string;
  purpose: string | null;
  language: string | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  elapsedS: number;
  outcome: (typeof OUTCOMES)[number] | null;
  category: (typeof CATEGORIES)[number] | null;
  summaryShort: string | null;
  refuseReason: string | null;
  leadId: string | null;
  sandbox: boolean;
  simulated: boolean;
  /** The API says the person can take this call over from the app (C1's `can_take_over`). Absent = false: nothing in the app offers Take over unless the API says it works for this call. */
  canTakeOver: boolean;
};
export type Captured = Readonly<Record<string, string>>;
export type Correction = { summary: string | null; captured: Captured; note: string | null; correctedAt: string };
/** A line of what was said; `textEn` = the same line in English (the API's `text_en`; null when the line is English or not translated yet). */
export type TranscriptLine = { who: "assistant" | "caller"; text: string; t: number; textEn: string | null };
export type CallDetail = CallRow & { summary: string | null; endReason: string | null; captured: Captured; transcript: TranscriptLine[] | null; correction: Correction | null };
export type CallsPage = { items: CallRow[]; nextCursor: string | null; pollAfterS: number };

const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const word = (v: unknown, max = 40): string | null => (typeof v === "string" && /^[a-z_]{1,40}$/.test(v) && v.length <= max ? v : null);
/** What was captured on a call: short facts by key ("visit_day": "Saturday"); keys are closed words, values short text (numbers are written as text). */
function captured(v: unknown): Captured {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v).slice(0, 30)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    const text = typeof x === "number" ? String(x) : typeof x === "string" ? x.trim().slice(0, 200) : null;
    if (text) out[k] = text;
  }
  return out;
}
export function parseCallRow(r: unknown): CallRow | null {
  if (!isRecord(r) || typeof r.id !== "string" || !isCanonicalUuid(r.id)) return null;
  const state = oneOf(r.state, CALL_STATES);
  const direction = oneOf(r.direction, ["outbound", "inbound"] as const);
  const createdAt = iso(r.created_at);
  if (!state || !direction || !createdAt) return null;
  return {
    id: r.id,
    direction,
    state,
    live: r.live === true,
    who: shortText(r.who, 120) ?? "",
    purpose: word(r.purpose),
    language: typeof r.language === "string" && /^[a-z]{2}$/.test(r.language) ? r.language : null,
    createdAt,
    answeredAt: iso(r.answered_at),
    endedAt: iso(r.ended_at),
    elapsedS: typeof r.elapsed_s === "number" && r.elapsed_s >= 0 ? Math.min(Math.trunc(r.elapsed_s), 86_400) : 0,
    outcome: oneOf(r.outcome, OUTCOMES),
    category: oneOf(r.category, CATEGORIES),
    summaryShort: shortText(r.summary_short, 300),
    refuseReason: word(r.refuse_reason),
    leadId: typeof r.lead_id === "string" && isCanonicalUuid(r.lead_id) ? r.lead_id : null,
    sandbox: r.sandbox !== false,
    simulated: r.simulated === true,
    canTakeOver: r.can_take_over === true,
  };
}
export function parseCallsPage(json: unknown): CallsPage {
  if (!isRecord(json) || !Array.isArray(json.items)) throw new ApiContractError("Unexpected calls body.");
  const poll = typeof json.poll_after_s === "number" && json.poll_after_s >= 2 ? Math.min(json.poll_after_s, 60) : 5;
  return { items: json.items.map(parseCallRow).filter((r): r is CallRow => r !== null).slice(0, 100), nextCursor: iso(json.next_cursor), pollAfterS: poll };
}
export function parseCallDetail(json: unknown, callId: string): CallDetail {
  const row = parseCallRow(json);
  if (!row || row.id !== callId || !isRecord(json)) throw new ApiContractError("Unexpected call body.");
  const transcript = Array.isArray(json.transcript)
    ? json.transcript.flatMap((x) => (isRecord(x) && (x.who === "assistant" || x.who === "caller") && typeof x.text === "string" && x.text.trim() !== "" ? [{ who: x.who as "assistant" | "caller", text: x.text.slice(0, 2000), t: typeof x.t === "number" && x.t >= 0 ? x.t : 0, textEn: typeof x.text_en === "string" && x.text_en.trim() !== "" && x.text_en.trim() !== x.text.trim() ? x.text_en.slice(0, 2000) : null }] : [])).slice(0, 500)
    : null;
  const c = isRecord(json.correction) ? json.correction : null;
  const correctedAt = c ? iso(c.corrected_at) : null;
  return {
    ...row,
    summary: shortText(json.summary, 1200),
    endReason: word(json.end_reason),
    captured: captured(json.captured),
    transcript,
    correction: c && correctedAt ? { summary: shortText(c.summary, 600), captured: captured(c.captured), note: shortText(c.note, 300), correctedAt } : null,
  };
}

const callsBase = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/calls`;
};
export async function listCalls(token: string, tenantId: string, cursor?: string | null): Promise<CallsPage> {
  const q = new URLSearchParams({ state: "all", limit: "50" });
  if (cursor && iso(cursor)) q.set("cursor", cursor);
  return parseCallsPage(await apiRequest(`${callsBase(tenantId)}?${q}`, token));
}
/** The calls that are live now (`GET /calls?state=live`: ringing or on the line), for the live bar. */
export async function listLiveCalls(token: string, tenantId: string): Promise<CallsPage> {
  return parseCallsPage(await apiRequest(`${callsBase(tenantId)}?state=live&limit=10`, token));
}
export async function getCall(token: string, tenantId: string, callId: string): Promise<CallDetail> {
  return parseCallDetail(await apiRequest(path(tenantId, callId), token), callId);
}
/** "Correct it": a missing field keeps what is there, an empty one clears it. The answer is what is now kept. */
export type CorrectionIn = { summary?: string; captured?: Record<string, string>; note?: string };
export async function correctCall(token: string, tenantId: string, callId: string, body: CorrectionIn): Promise<Correction> {
  const json = await apiRequest(`${path(tenantId, callId)}/correction`, token, { method: "POST", body: JSON.stringify(body) });
  const at = isRecord(json) ? iso(json.corrected_at) : null;
  if (!isRecord(json) || !at) throw new ApiContractError("Unexpected correction body.");
  return { summary: shortText(json.summary, 600), captured: captured(json.captured), note: shortText(json.note, 300), correctedAt: at };
}
export async function hangUpCall(token: string, tenantId: string, callId: string): Promise<void> {
  await apiRequest(`${path(tenantId, callId)}/hang-up`, token, { method: "POST" });
}

/**
 * The owner's test call (C1's PR #434, docs/contracts/calls.md "Place a test call"). `GET /calls/test-numbers` (Owner only, no-store; 503 `calls_unavailable` when this deployment places no calls) lists the phones that may be rung as
 * `{id, masked: "+91 ••••• 90129", label}`: the full number never reaches the browser. `POST /calls/place` takes the picked `to_id` (an unknown id is a 422: read the list again), the `language` and the `goal`; 202 `{call_id, state: "ringing"}`.
 * A call the gate refuses is 409 `call_not_allowed` with a closed `reason` (nothing is dialled); a provider failure is 502 `call_provider_failed`. The goal is kept by the API in memory only, so it is never read back.
 */
export type TestNumber = { id: string; masked: string; label: string | null };
export type TestNumbers = { items: TestNumber[]; /** What the form starts with (C1, 11 Nov): null = the API does not say */ defaultIntroduceAs: IntroduceAs | null };
export async function listTestNumbers(token: string, tenantId: string): Promise<TestNumbers> {
  const json = await apiRequest(`${callsBase(tenantId)}/test-numbers`, token);
  if (!isRecord(json) || !Array.isArray(json.items)) throw new ApiContractError("Unexpected test numbers body.");
  const items = json.items.flatMap((x) => (isRecord(x) && typeof x.id === "string" && /^[0-9a-f]{8,64}$/.test(x.id) && typeof x.masked === "string" && x.masked.length <= 24 && /^[+\d\s\u2022-]+$/u.test(x.masked) ? [{ id: x.id, masked: x.masked, label: shortText(x.label, 40) }] : [])).slice(0, 20);
  // C1's PR #457 adds the form's default way of introducing itself (the owner's saved choice, else their first name, else the business); an API that does not send it (or sends something odd) gives null
  const defaultIntroduceAs = json.default_introduce_as === undefined || json.default_introduce_as === null ? null : parseIntroduceAs(json.default_introduce_as);
  return { items, defaultIntroduceAs };
}
/** `goal: null` is the line check: no goal is sent, and the call is always in English (the API says so). */
export type PlaceTestCallIn = { toId: string; language: "en" | "te" | "kn" | "hi"; goal: string | null; /** "Introduce as" for this call only (C1, 11 Nov): absent = the saved setting. Only sent where the API has the field. */ introduceAs?: IntroduceAs | null; /** The tone (C1 adds `tone` to the place call; sent only when chosen, and only with TEST_CALL_TONE on) */ tone?: TestTone };
export async function placeTestCall(token: string, tenantId: string, body: PlaceTestCallIn): Promise<{ callId: string }> {
  const json = await apiRequest(`${callsBase(tenantId)}/place`, token, { method: "POST", body: JSON.stringify({ ...(body.goal === null ? { to_id: body.toId, language: "en" } : { to_id: body.toId, language: body.language, goal: body.goal }), ...(body.introduceAs ? { introduce_as: introduceToApi(body.introduceAs) } : {}), ...(body.tone ? { tone: body.tone } : {}) }) });
  if (!isRecord(json) || typeof json.call_id !== "string" || !isCanonicalUuid(json.call_id) || json.state !== "ringing") throw new ApiContractError("Unexpected place body.");
  return { callId: json.call_id };
}
