import type { ApprovedOut, CallItemOut, CampaignDetailOut, CampaignOut, PreviewOut, RecipientOut, ResultsOut, SampleOut, StepOut } from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, counts, int, iso, list, nstr, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * Reminder campaigns and the call list (job CQ, on the API of job CP, ADR 0086). Server side only, with the signed-in user's own token. A campaign is a list of people the business already deals with, one approved WhatsApp
 * template, one fixed text with merge fields and up to five steps; the Owner approves the WHOLE campaign once, with the second factor, after seeing rendered samples (the approval carries the hash of what was seen). Money is
 * integer paise and comes from the list or the ledger, never from a model. A response that does not match the contract is an error and nothing is shown.
 *
 * Who may do what (the API decides; the screens only hide what it would refuse): Owner, Admin and Sales read and edit drafts and read results and the call list; the Owner alone approves (second factor); Owner and Admin pause,
 * resume and cancel and start the bridge call; Owner, Admin and Sales write down a call's outcome.
 */
export const KINDS = ["payment_due", "delivery_update", "fee_due", "event", "exam", "holiday"] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ["draft", "approved", "running", "paused", "done", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const LANGUAGES = ["en", "te", "hi", "kn", "ta"] as const;
export const OUTCOMES = ["paid", "promised", "call_later", "wrong_number", "stop"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const MAX_ROWS = 5000;
export const MAX_PAISE = 100_000_000;
const STEP_STATES = ["planned", "submitted", "skipped"] as const;
const CLOSED = ["paid", "promised", "wrong_number", "stopped"] as const;

const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));

function parseSteps(v: unknown): StepOut[] {
  return list(v, "steps", 5).map((s) => {
    const r = rec(s, "step");
    return { offset_days: int(r.offset_days, "offset_days", -60, 180), time: typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : bad("time") };
  });
}

function campaignFields(r: Record<string, unknown>): CampaignOut {
  return {
    id: uuid(r.id, "id"),
    name: nstr(r.name, "name", 100),
    kind: oneOf(r.kind, KINDS, "kind"),
    status: oneOf(r.status, STATUSES, "status"),
    language: oneOf(r.language, LANGUAGES, "language"),
    wa_template_id: r.wa_template_id === null || r.wa_template_id === undefined ? null : uuid(r.wa_template_id, "wa_template_id"),
    message_text: str(r.message_text, "message_text", 700),
    steps: parseSteps(r.steps),
    call_after_step: optInt(r.call_after_step, "call_after_step", 1, 5),
    call_wait_hours: int(r.call_wait_hours, "call_wait_hours", 1, 168),
    audience_kind: oneOf(r.audience_kind, ["import", "filter"] as const, "audience_kind"),
    audience_filter: r.audience_filter === null || r.audience_filter === undefined ? null : (rec(r.audience_filter, "audience_filter") as Record<string, unknown>),
    approved_by: r.approved_by === null || r.approved_by === undefined ? null : uuid(r.approved_by, "approved_by"),
    approved_at: optIso(r.approved_at, "approved_at"),
    approved_recipients: optInt(r.approved_recipients, "approved_recipients", 0, MAX_ROWS),
    approved_total_paise: optInt(r.approved_total_paise, "approved_total_paise", 0, 100_000_000_000),
    created_at: iso(r.created_at, "created_at"),
    updated_at: iso(r.updated_at, "updated_at"),
    paused_at: optIso(r.paused_at, "paused_at"),
    cancelled_at: optIso(r.cancelled_at, "cancelled_at"),
    completed_at: optIso(r.completed_at, "completed_at"),
    recipients: int(r.recipients, "recipients", 0, MAX_ROWS),
    total_amount_paise: int(r.total_amount_paise, "total_amount_paise", 0, 100_000_000_000),
  };
}

export function parseCampaign(json: unknown): CampaignOut {
  return campaignFields(rec(json, "campaign"));
}

const issueMap = (v: unknown): Record<string, string> => {
  const r = rec(v ?? {}, "issue_text");
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(r)) out[word(k, "issue code")] = str(t, "issue text", 300);
  return out;
};
const issueList = (v: unknown): string[] => list(v ?? [], "issues", 40).map((x) => word(x, "issue"));

export function parseDetail(json: unknown): CampaignDetailOut {
  const r = rec(json, "campaign");
  return { ...campaignFields(r), issues: issueList(r.issues), issue_text: issueMap(r.issue_text), sending_on: bool(r.sending_on, "sending_on") };
}

export function parseCampaignList(json: unknown): { items: CampaignOut[]; next_cursor: string | null } {
  const r = rec(json, "campaign list");
  return { items: list(r.items, "items", 100).map(parseCampaign), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseSaved(json: unknown): { campaign: CampaignOut; created: boolean; back_to_draft: boolean } {
  const r = rec(json, "saved campaign");
  return { campaign: parseCampaign(r.campaign), created: bool(r.created, "created"), back_to_draft: bool(r.back_to_draft, "back_to_draft") };
}

function parseSample(json: unknown): SampleOut {
  const r = rec(json, "sample");
  return {
    recipient_id: uuid(r.recipient_id, "recipient_id"),
    labels: list(r.labels, "labels", 4).map((l) => oneOf(l, ["first", "longest", "highest_amount", "random"] as const, "label")),
    body: str(r.body, "body", 1500),
    amount_paise: optInt(r.amount_paise, "amount_paise", 0, MAX_PAISE),
    due_date: day(r.due_date, "due_date"),
  };
}

export function parsePreview(json: unknown): PreviewOut {
  const r = rec(json, "preview");
  return {
    campaign: parseCampaign(r.campaign),
    samples: list(r.samples, "samples", 8).map(parseSample),
    samples_sha256: typeof r.samples_sha256 === "string" && /^[0-9a-f]{64}$/.test(r.samples_sha256) ? r.samples_sha256 : bad("samples_sha256"),
    content_sha256: typeof r.content_sha256 === "string" && /^[0-9a-f]{64}$/.test(r.content_sha256) ? r.content_sha256 : bad("content_sha256"),
    recipients: int(r.recipients, "recipients", 0, MAX_ROWS),
    total_amount_paise: int(r.total_amount_paise, "total_amount_paise", 0, 100_000_000_000),
    first_due: r.first_due === null || r.first_due === undefined ? null : day(r.first_due, "first_due"),
    last_due: r.last_due === null || r.last_due === undefined ? null : day(r.last_due, "last_due"),
    disclosure: str(r.disclosure, "disclosure", 600),
    issues: issueList(r.issues),
    issue_text: issueMap(r.issue_text),
    sending_on: bool(r.sending_on, "sending_on"),
  };
}

export function parseApproved(json: unknown): ApprovedOut {
  const r = rec(json, "approval");
  return { campaign: parseCampaign(r.campaign), planned_steps: int(r.planned_steps, "planned_steps", 0, 100_000), past_steps: int(r.past_steps, "past_steps", 0, 100_000), sending_on: bool(r.sending_on, "sending_on") };
}

export function parseRecipient(json: unknown): RecipientOut {
  const r = rec(json, "recipient");
  return {
    id: uuid(r.id, "id"),
    seq: int(r.seq, "seq", 0, 1_000_000),
    contact_id: uuid(r.contact_id, "contact_id"),
    contact_name: str(r.contact_name, "contact_name", 200),
    due_date: day(r.due_date, "due_date"),
    amount_paise: optInt(r.amount_paise, "amount_paise", 0, MAX_PAISE),
    reference: optStr(r.reference, "reference", 60),
    closed_reason: r.closed_reason === null || r.closed_reason === undefined ? null : oneOf(r.closed_reason, CLOSED, "closed_reason"),
    promised_on: r.promised_on === null || r.promised_on === undefined ? null : day(r.promised_on, "promised_on"),
    steps: list(r.steps, "steps", 5).map((s) => {
      const x = rec(s, "step state");
      return { step_no: int(x.step_no, "step_no", 1, 5), scheduled_for: iso(x.scheduled_for, "scheduled_for"), status: oneOf(x.status, STEP_STATES, "status"), reason: optStr(x.reason, "reason", 60) };
    }),
  };
}

export function parseRecipients(json: unknown): RecipientOut[] {
  return list(json, "recipients", 200).map(parseRecipient);
}

export function parseAdded(json: unknown): { added: number; skipped: { row: number; reason: string }[]; recipients: number } {
  const r = rec(json, "recipients added");
  return {
    added: int(r.added, "added", 0, MAX_ROWS),
    skipped: list(r.skipped, "skipped", MAX_ROWS).map((s) => {
      const x = rec(s, "skipped row");
      return { row: int(x.row, "row", 1, 100_000), reason: word(x.reason, "reason") };
    }),
    recipients: int(r.recipients, "recipients", 0, MAX_ROWS),
  };
}

function paidCounts(v: unknown): Record<string, number> {
  const r = rec(v, "paid after reminder");
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(r)) out[word(k, "key")] = int(n, "count", 0, 100_000_000_000);
  return out;
}

export function parseResults(json: unknown): ResultsOut {
  const r = rec(json, "results");
  return {
    campaign_id: uuid(r.campaign_id, "campaign_id"),
    status: oneOf(r.status, STATUSES, "status"),
    recipients: int(r.recipients, "recipients", 0, MAX_ROWS),
    by_state: counts(r.by_state, "by_state"),
    by_reason: counts(r.by_reason, "by_reason"),
    by_day: list(r.by_day, "by_day", 400).map((d) => {
      const x = rec(d, "day");
      return { day: day(x.day, "day"), states: counts(x.states, "day states") } as Record<string, unknown>;
    }),
    delivered_total: int(r.delivered_total, "delivered_total", 0, 1_000_000),
    replied: int(r.replied, "replied", 0, MAX_ROWS),
    paid_after_reminder: paidCounts(r.paid_after_reminder),
    closed: counts(r.closed, "closed"),
    calls: (() => {
      const c = rec(r.calls, "calls");
      return { open: int(c.open ?? 0, "open", 0, MAX_ROWS), done: int(c.done ?? 0, "done", 0, MAX_ROWS), outcomes: counts(c.outcomes ?? {}, "outcomes") } as Record<string, unknown>;
    })(),
  };
}

export function parseCallItem(json: unknown): CallItemOut {
  const r = rec(json, "call item");
  return {
    id: uuid(r.id, "id"),
    campaign_id: uuid(r.campaign_id, "campaign_id"),
    campaign_name: nstr(r.campaign_name, "campaign_name", 100),
    recipient_id: uuid(r.recipient_id, "recipient_id"),
    contact_id: uuid(r.contact_id, "contact_id"),
    contact_name: str(r.contact_name, "contact_name", 200),
    amount_paise: optInt(r.amount_paise, "amount_paise", 0, MAX_PAISE),
    due_date: day(r.due_date, "due_date"),
    reference: optStr(r.reference, "reference", 60),
    step_no: int(r.step_no, "step_no", 1, 5),
    status: oneOf(r.status, ["open", "done"] as const, "status"),
    outcome: r.outcome === null || r.outcome === undefined ? null : oneOf(r.outcome, OUTCOMES, "outcome"),
    promised_on: r.promised_on === null || r.promised_on === undefined ? null : day(r.promised_on, "promised_on"),
    call_after: optIso(r.call_after, "call_after"),
    attempts: int(r.attempts, "attempts", 0, 1000),
    call_request_id: uuid(r.call_request_id, "call_request_id"),
    created_at: iso(r.created_at, "created_at"),
    sort_at: iso(r.sort_at, "sort_at"),
  };
}

export function parseCallList(json: unknown): { items: CallItemOut[]; next_cursor: string | null } {
  const r = rec(json, "call list");
  return { items: list(r.items, "items", 100).map(parseCallItem), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseOutcomeRecorded(json: unknown): { id: string; status: "open" | "done"; outcome: Outcome; replayed: boolean } {
  const r = rec(json, "outcome");
  return { id: uuid(r.id, "id"), status: oneOf(r.status, ["open", "done"] as const, "status"), outcome: oneOf(r.outcome, OUTCOMES, "outcome"), replayed: r.replayed === true };
}

export function parseBridge(json: unknown): { bridge_id: string; status: string; replayed: boolean } {
  const r = rec(json, "bridge");
  return { bridge_id: uuid(r.bridge_id, "bridge_id"), status: word(r.status, "status", 40), replayed: r.replayed === true };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ requests
const base = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const send = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type CampaignInput = { name: string; kind: Kind; language: (typeof LANGUAGES)[number]; waTemplateId: string | null; messageText: string; steps: readonly { offset_days: number; time: string }[]; callAfterStep: number | null; callWaitHours: number };

export async function listCampaigns(accessToken: string, tenantId: string, opts: { status?: Status; after?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.status) q.set("status", opts.status);
  if (opts.after) q.set("after", opts.after);
  return parseCampaignList(await apiRequest(base(tenantId, `campaigns?${q.toString()}`), accessToken));
}
export async function getCampaign(accessToken: string, tenantId: string, id: string) {
  return parseDetail(await apiRequest(base(tenantId, `campaigns/${idOf(id)}`), accessToken));
}

/** `PUT /campaigns/{id}`: the whole campaign; the same id again changes it. The kind never changes. A change to an approved campaign sends it back to draft (the answer says so). */
export async function putCampaign(accessToken: string, tenantId: string, id: string, c: CampaignInput) {
  const body: Record<string, unknown> = { name: c.name, kind: c.kind, language: c.language, message_text: c.messageText, steps: c.steps, call_wait_hours: c.callWaitHours };
  if (c.waTemplateId) body.wa_template_id = idOf(c.waTemplateId);
  if (c.callAfterStep !== null) body.call_after_step = c.callAfterStep;
  return parseSaved(await apiRequest(base(tenantId, `campaigns/${idOf(id)}`), accessToken, send("PUT", body)));
}

export type RecipientRow = { contact_id?: string; phone?: string; due_date: string; amount_paise?: number; reference?: string };
/** `POST /campaigns/{id}/recipients`: up to 5,000 rows; a row that cannot be added is reported, never fatal. */
export async function addRecipients(accessToken: string, tenantId: string, id: string, rows: readonly RecipientRow[]) {
  if (rows.length < 1 || rows.length > MAX_ROWS) throw new ApiContractError("rows");
  return parseAdded(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/recipients`), accessToken, send("POST", { rows })));
}
export type LedgerFilter = { due_from: string; due_to: string; party?: "company" | "contact"; min_open_paise?: number };
export async function addRecipientsFromLedger(accessToken: string, tenantId: string, id: string, f: LedgerFilter) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.due_from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.due_to)) throw new ApiContractError("date");
  return parseAdded(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/recipients/from-ledger`), accessToken, send("POST", f)));
}
export async function listRecipients(accessToken: string, tenantId: string, id: string, opts: { after?: number; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.after !== undefined) q.set("after", String(opts.after));
  return parseRecipients(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/recipients?${q.toString()}`), accessToken));
}
export async function clearRecipients(accessToken: string, tenantId: string, id: string) {
  return int(rec(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/recipients/clear`), accessToken, send("POST")), "removed").removed, "removed", 0, MAX_ROWS);
}
export async function removeRecipient(accessToken: string, tenantId: string, id: string, recipientId: string) {
  return int(rec(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/recipients/${idOf(recipientId)}/remove`), accessToken, send("POST")), "removed").removed, "removed", 0, MAX_ROWS);
}
export async function getPreview(accessToken: string, tenantId: string, id: string) {
  return parsePreview(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/preview`), accessToken));
}
/** `POST /campaigns/{id}/approve`: the Owner, with the second factor, passing the hash of the samples they saw. If the campaign changed since, the answer is 409 `samples_changed`. Approving sends nothing by itself. */
export async function approveCampaign(accessToken: string, tenantId: string, id: string, samplesSha256: string) {
  if (!/^[0-9a-f]{64}$/.test(samplesSha256)) throw new ApiContractError("hash");
  return parseApproved(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/approve`), accessToken, send("POST", { samples_sha256: samplesSha256 })));
}
export async function setCampaignState(accessToken: string, tenantId: string, id: string, action: "pause" | "resume" | "cancel") {
  return parseCampaign(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/${action}`), accessToken, send("POST")));
}
export async function getResults(accessToken: string, tenantId: string, id: string) {
  return parseResults(await apiRequest(base(tenantId, `campaigns/${idOf(id)}/results`), accessToken));
}

export async function getCallList(accessToken: string, tenantId: string, opts: { status?: "open" | "done"; after?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ status: opts.status ?? "open", limit: String(opts.limit ?? 50) });
  if (opts.after) q.set("after", opts.after);
  return parseCallList(await apiRequest(base(tenantId, `call-list?${q.toString()}`), accessToken));
}
export async function recordOutcome(accessToken: string, tenantId: string, itemId: string, o: { outcome: Outcome; promisedOn?: string | null; callAfter?: string | null }) {
  const body: Record<string, unknown> = { outcome: o.outcome };
  if (o.promisedOn) body.promised_on = o.promisedOn;
  if (o.callAfter) body.call_after = o.callAfter;
  return parseOutcomeRecorded(await apiRequest(base(tenantId, `call-list/${idOf(itemId)}/outcome`), accessToken, send("POST", body)));
}
/** `POST /call-requests/{id}/connect`: the shop's own phone rings first, the customer's when the shop picks up; only 9 am to 9 pm India time; Owner and Admin. */
export async function connectCall(accessToken: string, tenantId: string, callRequestId: string) {
  return parseBridge(await apiRequest(base(tenantId, `call-requests/${idOf(callRequestId)}/connect`), accessToken, send("POST")));
}
