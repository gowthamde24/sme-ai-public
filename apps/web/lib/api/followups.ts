import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the follow-up endpoints of OUR API (T010 part 2, ADR 0022; commit 3).
 *
 * A touch, a draft and an approval are RECORDS of what a person did OUTSIDE this system: nothing here sends a message. A draft's wording is the closed template the DATABASE copies: no request carries
 * wording, a contact, a tenant, a status or an approver (the lead names the contact, the URL names the tenant, the token names the approver). `occurred_at` null means "now" (the database clock) and a
 * time after now is refused. A response that does not match the contract is an error, never rendered. The response types are the API's models (services/ai-api/app/followups/models.py).
 */
export const DIRECTIONS = ["out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const TOUCH_CHANNELS = ["email", "whatsapp", "phone"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];
export const DRAFT_CHANNELS = ["email", "whatsapp"] as const;
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];
export const DRAFT_STATUSES = ["draft", "approved", "discarded", "recorded_sent"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DISCARD_CODES = ["person", "superseded", "reply_recorded", "suppressed", "erased"] as const;
export type DiscardCode = (typeof DISCARD_CODES)[number];
export const QUESTION_STATUSES = ["draft", "approved", "discarded"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export const QUESTION_DISCARD_CODES = ["person", "resolved", "superseded"] as const;
export type QuestionDiscardCode = (typeof QUESTION_DISCARD_CODES)[number];
export const ACTIONS = ["wait", "draft_followup", "stop"] as const;
export type EngineAction = (typeof ACTIONS)[number];

export const CHANNEL_LABELS: Record<TouchChannel, string> = { email: "E-mail", whatsapp: "WhatsApp", phone: "Phone call" };
/** A draft is for a person to send themselves: "recorded as sent" is a person's word. */
export const STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "Draft: waiting for approval",
  approved: "Approved: ready for you to send yourself",
  discarded: "Discarded",
  recorded_sent: "Recorded: you sent it yourself",
};
export const DISCARD_LABELS: Record<DiscardCode, string> = {
  person: "a person discarded it",
  superseded: "a newer touch was recorded",
  reply_recorded: "the customer replied",
  suppressed: "the contact was suppressed",
  erased: "the contact was erased",
};
export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = { draft: "Draft", approved: "Approved: ready to copy", discarded: "Discarded" };
export const QUESTION_DISCARD_LABELS: Record<QuestionDiscardCode, string> = {
  person: "a person discarded it",
  resolved: "no longer needed",
  superseded: "the question changed",
};
export const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export interface PolicyVersion {
  id: string;
  version_no: number;
  effective_from: string;
  gap_days: number[];
  max_touches: number;
  quiet_start: string;
  quiet_end: string;
  allowed_weekdays: number[];
  holidays: string[];
  min_gap_hours: number;
  recipient_utc_offset_minutes: number;
  created_at: string;
}
export interface PolicyResult {
  version_id: string;
  version_no: number;
  effective_from: string;
  replayed: boolean;
}
export interface Touch {
  id: string;
  lead_id: string;
  contact_id: string | null;
  direction: Direction;
  channel: TouchChannel;
  occurred_at: string;
  draft_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
}
export interface TouchResult {
  touch_id: string;
  lead_id: string;
  direction: Direction;
  replayed: boolean;
}
export interface Draft {
  id: string;
  lead_id: string;
  contact_id: string;
  touch_number: number;
  status: DraftStatus;
  channel: DraftChannel;
  template_code: string;
  body: string;
  policy_version_id: string;
  engine_version: string;
  /** The fingerprint of the draft as shown: the approval carries it back, and a draft whose state moved since is refused as stale. */
  state_hash: string;
  as_of: string;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  discarded_by: string | null;
  discarded_at: string | null;
  discard_code: DiscardCode | null;
}
export interface DraftResult {
  draft_id: string;
  lead_id: string;
  touch_number: number;
  status: DraftStatus;
  replayed: boolean;
}
export interface DraftStatusResult {
  draft_id: string;
  status: DraftStatus;
  replayed: boolean;
}
export interface SentResult {
  draft_id: string;
  touch_id: string;
  status: DraftStatus;
  replayed: boolean;
}
export interface Gate {
  /** contact | key | erased | consent | unkeyed | null. (An erased marker on a key is `key`: the API never says more.) */
  blocked: string | null;
  stopped: string | null;
  policy_in_force: boolean;
}
export interface Decision {
  action: EngineAction | null;
  reason_code: string;
  terminal: boolean | null;
  touch_number: number | null;
  next_eligible_at: string | null;
  engine_version: string;
}
export interface LeadFollowup {
  lead_id: string;
  channel: DraftChannel;
  gate: Gate;
  decision: Decision | null;
  policy_version_id: string | null;
  touches: Touch[];
  drafts: Draft[];
}
export interface DueItem {
  lead_id: string;
  action: EngineAction;
  reason_code: string;
  touch_number: number;
  next_eligible_at: string | null;
  open_draft_id: string | null;
}
export interface QuestionDraft {
  id: string;
  requirement_id: string;
  line_no: number;
  question_code: string;
  question_text: string;
  status: QuestionStatus;
  created_by: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  discard_code: QuestionDiscardCode | null;
}
export interface QuestionSync {
  requirement_id: string;
  changed: number;
  drafts: QuestionDraft[];
}
export interface QuestionDecision {
  draft_id: string;
  status: QuestionStatus;
  replayed: boolean;
}

// ----------------------------------------------------------------------------- parsing
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a follow-up response.`);
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k));
const strOrNull = (r: Rec, k: string): string | null => (r[k] === null ? null : str(r, k));
const int = (r: Rec, k: string): number => (typeof r[k] === "number" && Number.isSafeInteger(r[k]) ? (r[k] as number) : bad(k));
const intOrNull = (r: Rec, k: string): number | null => (r[k] === null ? null : int(r, k));
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k));
const boolOrNull = (r: Rec, k: string): boolean | null => (r[k] === null ? null : bool(r, k));
function oneOf<T extends string>(r: Rec, k: string, allowed: readonly T[]): T {
  const v = r[k];
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(k);
}
const oneOfOrNull = <T extends string>(r: Rec, k: string, allowed: readonly T[]): T | null => (r[k] === null ? null : oneOf(r, k, allowed));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(what));
const ints = (v: unknown, what: string): number[] => list(v, what).map((n) => (typeof n === "number" && Number.isSafeInteger(n) ? n : bad(what)));
const strings = (v: unknown, what: string): string[] => list(v, what).map((s) => (typeof s === "string" ? s : bad(what)));
const rec = (v: unknown, what: string): Rec => (isRecord(v) ? v : bad(what));

export function parsePolicyVersion(json: unknown): PolicyVersion {
  const r = rec(json, "policy version");
  return {
    id: str(r, "id"),
    version_no: int(r, "version_no"),
    effective_from: str(r, "effective_from"),
    gap_days: ints(r.gap_days, "gap_days"),
    max_touches: int(r, "max_touches"),
    quiet_start: str(r, "quiet_start"),
    quiet_end: str(r, "quiet_end"),
    allowed_weekdays: ints(r.allowed_weekdays, "allowed_weekdays"),
    holidays: strings(r.holidays, "holidays"),
    min_gap_hours: int(r, "min_gap_hours"),
    recipient_utc_offset_minutes: int(r, "recipient_utc_offset_minutes"),
    created_at: str(r, "created_at"),
  };
}
export const parsePolicyVersions = (json: unknown): PolicyVersion[] => list(json, "policy versions").map(parsePolicyVersion);

export function parsePolicyResult(json: unknown): PolicyResult {
  const r = rec(json, "policy result");
  return { version_id: str(r, "version_id"), version_no: int(r, "version_no"), effective_from: str(r, "effective_from"), replayed: bool(r, "replayed") };
}

export function parseTouch(json: unknown): Touch {
  const r = rec(json, "touch");
  return {
    id: str(r, "id"),
    lead_id: str(r, "lead_id"),
    contact_id: strOrNull(r, "contact_id"),
    direction: oneOf(r, "direction", DIRECTIONS),
    channel: oneOf(r, "channel", TOUCH_CHANNELS),
    occurred_at: str(r, "occurred_at"),
    draft_id: strOrNull(r, "draft_id"),
    recorded_by: strOrNull(r, "recorded_by"),
    recorded_at: str(r, "recorded_at"),
  };
}

export function parseTouchResult(json: unknown): TouchResult {
  const r = rec(json, "touch result");
  return { touch_id: str(r, "touch_id"), lead_id: str(r, "lead_id"), direction: oneOf(r, "direction", DIRECTIONS), replayed: bool(r, "replayed") };
}

export function parseDraft(json: unknown): Draft {
  const r = rec(json, "draft");
  return {
    id: str(r, "id"),
    lead_id: str(r, "lead_id"),
    contact_id: str(r, "contact_id"),
    touch_number: int(r, "touch_number"),
    status: oneOf(r, "status", DRAFT_STATUSES),
    channel: oneOf(r, "channel", DRAFT_CHANNELS),
    template_code: str(r, "template_code"),
    body: str(r, "body"),
    policy_version_id: str(r, "policy_version_id"),
    engine_version: str(r, "engine_version"),
    state_hash: str(r, "state_hash"),
    as_of: str(r, "as_of"),
    created_by: strOrNull(r, "created_by"),
    created_at: str(r, "created_at"),
    approved_by: strOrNull(r, "approved_by"),
    approved_at: strOrNull(r, "approved_at"),
    discarded_by: strOrNull(r, "discarded_by"),
    discarded_at: strOrNull(r, "discarded_at"),
    discard_code: oneOfOrNull(r, "discard_code", DISCARD_CODES),
  };
}
export const parseDrafts = (json: unknown): Draft[] => list(json, "drafts").map(parseDraft);

export function parseDraftResult(json: unknown): DraftResult {
  const r = rec(json, "draft result");
  return { draft_id: str(r, "draft_id"), lead_id: str(r, "lead_id"), touch_number: int(r, "touch_number"), status: oneOf(r, "status", DRAFT_STATUSES), replayed: bool(r, "replayed") };
}
export function parseDraftStatusResult(json: unknown): DraftStatusResult {
  const r = rec(json, "draft status");
  return { draft_id: str(r, "draft_id"), status: oneOf(r, "status", DRAFT_STATUSES), replayed: bool(r, "replayed") };
}
export function parseSentResult(json: unknown): SentResult {
  const r = rec(json, "sent result");
  return { draft_id: str(r, "draft_id"), touch_id: str(r, "touch_id"), status: oneOf(r, "status", DRAFT_STATUSES), replayed: bool(r, "replayed") };
}

export function parseGate(json: unknown): Gate {
  const r = rec(json, "gate");
  return { blocked: strOrNull(r, "blocked"), stopped: strOrNull(r, "stopped"), policy_in_force: bool(r, "policy_in_force") };
}

export function parseDecision(json: unknown): Decision {
  const r = rec(json, "decision");
  return {
    action: oneOfOrNull(r, "action", ACTIONS),
    reason_code: str(r, "reason_code"),
    terminal: boolOrNull(r, "terminal"),
    touch_number: intOrNull(r, "touch_number"),
    next_eligible_at: strOrNull(r, "next_eligible_at"),
    engine_version: str(r, "engine_version"),
  };
}

export function parseLeadFollowup(json: unknown): LeadFollowup {
  const r = rec(json, "lead follow-up");
  return {
    lead_id: str(r, "lead_id"),
    channel: oneOf(r, "channel", DRAFT_CHANNELS),
    gate: parseGate(r.gate),
    decision: r.decision === null ? null : parseDecision(r.decision),
    policy_version_id: strOrNull(r, "policy_version_id"),
    touches: list(r.touches, "touches").map(parseTouch),
    drafts: list(r.drafts, "drafts").map(parseDraft),
  };
}

export function parseDueItem(json: unknown): DueItem {
  const r = rec(json, "due item");
  return {
    lead_id: str(r, "lead_id"),
    action: oneOf(r, "action", ACTIONS),
    reason_code: str(r, "reason_code"),
    touch_number: int(r, "touch_number"),
    next_eligible_at: strOrNull(r, "next_eligible_at"),
    open_draft_id: strOrNull(r, "open_draft_id"),
  };
}
export const parseDueItems = (json: unknown): DueItem[] => list(json, "due list").map(parseDueItem);

export function parseQuestionDraft(json: unknown): QuestionDraft {
  const r = rec(json, "question draft");
  return {
    id: str(r, "id"),
    requirement_id: str(r, "requirement_id"),
    line_no: int(r, "line_no"),
    question_code: str(r, "question_code"),
    question_text: str(r, "question_text"),
    status: oneOf(r, "status", QUESTION_STATUSES),
    created_by: strOrNull(r, "created_by"),
    created_at: str(r, "created_at"),
    decided_by: strOrNull(r, "decided_by"),
    decided_at: strOrNull(r, "decided_at"),
    discard_code: oneOfOrNull(r, "discard_code", QUESTION_DISCARD_CODES),
  };
}
export const parseQuestionDrafts = (json: unknown): QuestionDraft[] => list(json, "question drafts").map(parseQuestionDraft);

export function parseQuestionSync(json: unknown): QuestionSync {
  const r = rec(json, "question sync");
  return { requirement_id: str(r, "requirement_id"), changed: int(r, "changed"), drafts: parseQuestionDrafts(r.drafts) };
}
export function parseQuestionDecision(json: unknown): QuestionDecision {
  const r = rec(json, "question decision");
  return { draft_id: str(r, "draft_id"), status: oneOf(r, "status", QUESTION_STATUSES), replayed: bool(r, "replayed") };
}

// ----------------------------------------------------------------------------- requests (ids are checked BEFORE they reach a path)
function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
const base = (tenantId: string) => `/v1/tenants/${tenantId}`;
const post = (body?: unknown): RequestInit => (body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) });

export async function fetchPolicyVersions(accessToken: string, tenantId: string): Promise<PolicyVersion[]> {
  checked(tenantId);
  return parsePolicyVersions(await apiRequest(`${base(tenantId)}/followup-policy-versions`, accessToken));
}

export interface PolicyInput {
  id: string;
  effectiveFrom: string;
  gapDays: number[];
  maxTouches: number;
  quietStart: string;
  quietEnd: string;
  allowedWeekdays: number[];
  holidays: string[];
  minGapHours: number;
  recipientUtcOffsetMinutes: number;
}
/** The Owner (second factor) publishes a cadence policy version. The body is the policy and nothing else. */
export async function createPolicyVersion(accessToken: string, tenantId: string, input: PolicyInput): Promise<PolicyResult> {
  checked(tenantId, input.id);
  return parsePolicyResult(
    await apiRequest(
      `${base(tenantId)}/followup-policy-versions`,
      accessToken,
      post({
        id: input.id,
        effective_from: input.effectiveFrom,
        gap_days: input.gapDays,
        max_touches: input.maxTouches,
        quiet_start: input.quietStart,
        quiet_end: input.quietEnd,
        allowed_weekdays: input.allowedWeekdays,
        holidays: input.holidays,
        min_gap_hours: input.minGapHours,
        recipient_utc_offset_minutes: input.recipientUtcOffsetMinutes,
      }),
    ),
  );
}

export async function fetchLeadFollowup(accessToken: string, tenantId: string, leadId: string, channel: DraftChannel = "email"): Promise<LeadFollowup> {
  checked(tenantId, leadId);
  return parseLeadFollowup(await apiRequest(`${base(tenantId)}/leads/${leadId}/followup?channel=${channel}`, accessToken));
}

export interface TouchInput {
  id: string;
  direction: Direction;
  channel: TouchChannel;
  /** ISO time with an offset, never after now; undefined = now (the database clock). */
  occurredAt?: string;
}
/** A person records "I sent it" (out) or "they replied" (in). Nothing is sent. The body has the person's inputs only. */
export async function recordTouch(accessToken: string, tenantId: string, leadId: string, input: TouchInput): Promise<TouchResult> {
  checked(tenantId, leadId, input.id);
  const body: Record<string, unknown> = { id: input.id, direction: input.direction, channel: input.channel };
  if (input.occurredAt !== undefined) body.occurred_at = input.occurredAt;
  return parseTouchResult(await apiRequest(`${base(tenantId)}/leads/${leadId}/touches`, accessToken, post(body)));
}

/** Ask for a follow-up DRAFT. The body is an id and a channel: no wording, no contact, no status (the database copies a closed template for the lead's own contact). */
export async function createDraft(accessToken: string, tenantId: string, leadId: string, input: { id: string; channel: DraftChannel }): Promise<DraftResult> {
  checked(tenantId, leadId, input.id);
  return parseDraftResult(await apiRequest(`${base(tenantId)}/leads/${leadId}/followup-drafts`, accessToken, post({ id: input.id, channel: input.channel })));
}

export async function fetchDraft(accessToken: string, tenantId: string, draftId: string): Promise<Draft> {
  checked(tenantId, draftId);
  return parseDraft(await apiRequest(`${base(tenantId)}/followup-drafts/${draftId}`, accessToken));
}

export async function fetchDrafts(accessToken: string, tenantId: string, opts: { leadId?: string; status?: DraftStatus | "active"; limit?: number } = {}): Promise<Draft[]> {
  checked(tenantId);
  const query = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.leadId !== undefined) {
    checked(opts.leadId);
    query.set("lead_id", opts.leadId);
  }
  if (opts.status !== undefined) query.set("status", opts.status);
  return parseDrafts(await apiRequest(`${base(tenantId)}/followup-drafts?${query}`, accessToken));
}

/** Approve the draft the person REVIEWED: the body is its fingerprint (`state_hash` as shown). The database refuses a draft whose state moved since. */
export async function approveDraft(accessToken: string, tenantId: string, draftId: string, stateHash: string): Promise<DraftStatusResult> {
  checked(tenantId, draftId);
  if (!/^[0-9a-f]{64}$/.test(stateHash)) throw new ApiContractError("state_hash");
  return parseDraftStatusResult(await apiRequest(`${base(tenantId)}/followup-drafts/${draftId}/approve`, accessToken, post({ state_hash: stateHash })));
}

export async function discardDraft(accessToken: string, tenantId: string, draftId: string): Promise<DraftStatusResult> {
  checked(tenantId, draftId);
  return parseDraftStatusResult(await apiRequest(`${base(tenantId)}/followup-drafts/${draftId}/discard`, accessToken, post()));
}

/** "I sent it myself", for an APPROVED draft: a person's word, recorded as an outbound touch. */
export async function recordSent(accessToken: string, tenantId: string, draftId: string, input: { touchId: string; occurredAt?: string }): Promise<SentResult> {
  checked(tenantId, draftId, input.touchId);
  const body: Record<string, unknown> = { touch_id: input.touchId };
  if (input.occurredAt !== undefined) body.occurred_at = input.occurredAt;
  return parseSentResult(await apiRequest(`${base(tenantId)}/followup-drafts/${draftId}/sent`, accessToken, post(body)));
}

export async function fetchDueList(accessToken: string, tenantId: string): Promise<DueItem[]> {
  checked(tenantId);
  return parseDueItems(await apiRequest(`${base(tenantId)}/followups/due`, accessToken));
}

export async function fetchQuestionDrafts(accessToken: string, tenantId: string, requirementId: string, activeOnly = true): Promise<QuestionDraft[]> {
  checked(tenantId, requirementId);
  return parseQuestionDrafts(await apiRequest(`${base(tenantId)}/requirements/${requirementId}/question-drafts?active_only=${activeOnly}`, accessToken));
}

/** Store the clarifying questions the closed templates derive from the requirement NOW (random ids are made by the API). Nothing is sent. */
export async function syncQuestionDrafts(accessToken: string, tenantId: string, requirementId: string): Promise<QuestionSync> {
  checked(tenantId, requirementId);
  return parseQuestionSync(await apiRequest(`${base(tenantId)}/requirements/${requirementId}/question-drafts/sync`, accessToken, post()));
}

export async function approveQuestionDraft(accessToken: string, tenantId: string, draftId: string): Promise<QuestionDecision> {
  checked(tenantId, draftId);
  return parseQuestionDecision(await apiRequest(`${base(tenantId)}/question-drafts/${draftId}/approve`, accessToken, post()));
}

export async function discardQuestionDraft(accessToken: string, tenantId: string, draftId: string): Promise<QuestionDecision> {
  checked(tenantId, draftId);
  return parseQuestionDecision(await apiRequest(`${base(tenantId)}/question-drafts/${draftId}/discard`, accessToken, post()));
}
