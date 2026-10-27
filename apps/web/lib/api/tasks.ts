import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, int, iso, list, nstr, oneOf, optInt, optIso, optStr, rec, str, uuid, word, type Rec } from "./shape";
import {
  CONTACT_STATUSES,
  FOLLOW_UPS,
  QUESTION_TYPES,
  SHORT_ANSWER_KINDS,
  TASK_CHANNELS,
  TASK_LANGS,
  TASK_STATUSES,
  TASK_TEMPLATES,
  type Estimate,
  type PlanOut,
  type Progress,
  type ReportOut,
  type ReportRow,
  type ReportTotals,
  type TaskContactOut,
  type TaskContactsOut,
  type TaskLang,
  type TaskOut,
  type TaskStatus,
  type TemplateOut,
  type TemplatesOut,
  type TranscriptLine,
} from "@/lib/tasks/types";

/**
 * "Ask Vijaya to do it" (night 4, job DR part B; contract-tasks.md, the generated packages/contracts/tasks.ts): plan an instruction, answer its one question, look at the people, leave some out, approve ONCE, watch the progress,
 * pause or cancel, and read the report. SERVER ONLY, the signed-in person's own token. Every answer is read with the checks of lib/api/shape.ts: a body that is not the contract is an ApiContractError, never drawn. Every result is
 * `simulated: true` until telephony exists, and the wording the API makes is `draft`. There is no DELETE verb: every "remove" is a POST. The words in a plan or a report come from the API and are shown as plain text only.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/tasks`;
};
const taskPath = (tenantId: string, taskId: string, tail = ""): string => {
  if (!isCanonicalUuid(taskId)) throw new ApiContractError("task id");
  return `${base(tenantId)}/${taskId}${tail}`;
};

const MONEY_MAX = 1_000_000_000_00;
const money = (v: unknown, what: string): number => int(v, what, 0, MONEY_MAX);
const count = (v: unknown, what: string): number => int(v, what, 0, 1_000_000);
const text = (v: unknown, what: string, max = 2000): string => str(v, what, max);
const simulated = (x: Rec): boolean => (x.simulated === undefined ? true : x.simulated === true ? true : bad("simulated"));
const draft = (x: Rec): "draft" => (x.wording === undefined || x.wording === "draft" ? "draft" : bad("wording"));

/** What a person or a contact captured: closed names to short plain values. */
function captured(v: unknown, what: string): Record<string, string | number | boolean | null> | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, what);
  const keys = Object.keys(r);
  if (keys.length > 30) bad(what);
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of keys) {
    const value = r[k];
    if (value === null || typeof value === "boolean") out[word(k, what)] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[word(k, what)] = value;
    else if (typeof value === "string" && value.length <= 500) out[word(k, what)] = value;
    else bad(what);
  }
  return out;
}

export function parsePlan(json: unknown): PlanOut {
  const x = rec(json, "plan");
  const w = rec(x.window, "plan window");
  const f = rec(x.follow_up ?? { kind: "none", after_hours: 24 }, "plan follow_up");
  const date = str(w.date, "window date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad("window date");
  return {
    channel: oneOf(x.channel, TASK_CHANNELS, "channel"),
    goal: text(x.goal, "goal", 1000),
    questions: list(x.questions ?? [], "questions", 20).map((row) => {
      const q = rec(row, "question");
      return { key: word(q.key, "question key", 60), text: text(q.text, "question text", 500), type: q.type === undefined ? "text" : oneOf(q.type, QUESTION_TYPES, "question type") };
    }),
    script_notes: text(x.script_notes ?? "", "script_notes", 2000),
    message_text: optStr(x.message_text, "message_text", 1000),
    window: { date, from_minute: int(w.from_minute, "from_minute", 0, 1439), to_minute: int(w.to_minute, "to_minute", 0, 1440) },
    follow_up: { kind: oneOf(f.kind, FOLLOW_UPS, "follow_up kind"), after_hours: int(f.after_hours ?? 24, "after_hours", 0, 24 * 60) },
    contacts_total: count(x.contacts_total, "contacts_total"),
    contacts_sample: list(x.contacts_sample ?? [], "contacts_sample", 100).map((row) => {
      const s = rec(row, "sample contact");
      return { contact_id: uuid(s.contact_id, "contact_id"), name: optStr(s.name, "sample name", 200) };
    }),
    unmatched: list(x.unmatched ?? [], "unmatched", 600).map((row) => {
      const u = rec(row, "unmatched");
      return { name: optStr(u.name, "unmatched name", 200), phone_last4: str(u.phone_last4, "phone_last4", 8) };
    }),
    notes: list(x.notes ?? [], "notes", 20).map((n) => text(n, "note", 500)),
  };
}

function parseEstimate(json: unknown): Estimate {
  const x = rec(json, "estimate");
  return { contacts: count(x.contacts, "contacts"), calls: count(x.calls, "calls"), messages: count(x.messages, "messages"), minutes: count(x.minutes, "minutes"), cost_paise: money(x.cost_paise, "cost_paise"), basis: text(x.basis, "basis", 200) };
}

export function parseProgress(json: unknown): Progress {
  const x = rec(json, "progress");
  return { total: count(x.total, "total"), excluded: count(x.excluded, "excluded"), waiting: count(x.waiting, "waiting"), in_progress: count(x.in_progress, "in_progress"), done: count(x.done, "done"), failed: count(x.failed, "failed"), skipped: count(x.skipped, "skipped"), reached: count(x.reached, "reached"), positive: count(x.positive, "positive") };
}

export function parseTask(json: unknown): TaskOut {
  const x = rec(json, "task");
  const status = oneOf(x.status, TASK_STATUSES, "status");
  const pause = x.pause_reason === null || x.pause_reason === undefined ? null : oneOf(x.pause_reason, ["cap", "owner"] as const, "pause_reason");
  const sha = optStr(x.plan_sha256, "plan_sha256", 64);
  if (sha !== null && !/^[0-9a-f]{8,64}$/i.test(sha)) bad("plan_sha256");
  return {
    id: uuid(x.id, "id"),
    status,
    instruction: text(x.instruction, "instruction", 1600),
    language: oneOf(x.language, TASK_LANGS, "language"),
    template: oneOf(x.template, TASK_TEMPLATES, "template"),
    question: optStr(x.question, "question", 600),
    plan: x.plan === null || x.plan === undefined ? null : parsePlan(x.plan),
    estimate: x.estimate === null || x.estimate === undefined ? null : parseEstimate(x.estimate),
    cap_paise: optInt(x.cap_paise, "cap_paise", 0, MONEY_MAX),
    spent_paise: money(x.spent_paise, "spent_paise"),
    pause_reason: pause,
    progress: parseProgress(x.progress),
    plan_sha256: sha,
    simulated: simulated(x),
    wording: draft(x),
    created_at: iso(x.created_at, "created_at"),
    approved_at: optIso(x.approved_at, "approved_at"),
    finished_at: optIso(x.finished_at, "finished_at"),
  };
}

export function parseTaskList(json: unknown): TaskOut[] {
  return list(json, "task list", 200).map(parseTask);
}

export function parseTaskContacts(json: unknown): TaskContactsOut {
  const x = rec(json, "task contacts");
  return {
    contacts: list(x.contacts, "contacts", 500).map((row): TaskContactOut => {
      const c = rec(row, "task contact");
      return {
        id: uuid(c.id, "id"),
        contact_id: uuid(c.contact_id, "contact_id"),
        name: nstr(c.name, "name", 200),
        phone_last4: optStr(c.phone_last4, "phone_last4", 8),
        status: oneOf(c.status, CONTACT_STATUSES, "contact status"),
        skip_reason: optStr(c.skip_reason, "skip_reason", 80),
        outcome: optStr(c.outcome, "outcome", 80),
        outcome_category: optStr(c.outcome_category, "outcome_category", 80),
        captured: captured(c.captured, "captured"),
        simulated: simulated(c),
      };
    }),
    next_cursor: optStr(x.next_cursor, "next_cursor", 200),
  };
}

function parseTranscript(v: unknown): TranscriptLine[] | null {
  if (v === null || v === undefined) return null;
  return list(v, "transcript", 200).map((row) => {
    const l = rec(row, "transcript line");
    return { who: oneOf(l.who, ["assistant", "contact"] as const, "who"), text: text(l.text, "transcript text", 1000) };
  });
}

function parseReportTotals(json: unknown): ReportTotals {
  const x = rec(json, "totals");
  return { contacts: count(x.contacts, "contacts"), reached: count(x.reached, "reached"), positive: count(x.positive, "positive"), negative: count(x.negative, "negative"), unclear: count(x.unclear, "unclear"), no_answer: count(x.no_answer, "no_answer"), spent_paise: money(x.spent_paise, "spent_paise") };
}

export function parseReport(json: unknown): ReportOut {
  const x = rec(json, "report");
  return {
    task_id: uuid(x.task_id, "task_id"),
    status: oneOf(x.status, TASK_STATUSES, "status"),
    short_answer: text(x.short_answer, "short_answer", 600),
    short_answer_kind: oneOf(x.short_answer_kind, SHORT_ANSWER_KINDS, "short_answer_kind"),
    totals: parseReportTotals(x.totals),
    rows: list(x.rows, "rows", 1000).map((row): ReportRow => {
      const r = rec(row, "report row");
      return {
        contact_id: uuid(r.contact_id, "contact_id"),
        name: nstr(r.name, "name", 200),
        phone_last4: optStr(r.phone_last4, "phone_last4", 8),
        outcome: word(r.outcome, "outcome", 40),
        category: r.category === null || r.category === undefined ? null : word(r.category, "category", 60),
        captured: captured(r.captured, "captured"),
        transcript: parseTranscript(r.transcript),
        recording_url: null, // no telephony yet: a link from the API is never followed or drawn
        simulated: simulated(r),
        message_status: r.message_status === null || r.message_status === undefined ? null : word(r.message_status, "message_status", 40),
      };
    }),
    simulated: simulated(x),
    wording: draft(x),
  };
}

export function parseTemplates(json: unknown): TemplatesOut {
  const x = rec(json, "templates");
  return {
    templates: list(x.templates, "templates", 30).map((row): TemplateOut => {
      const t = rec(row, "template");
      const id = oneOf(t.id, TASK_TEMPLATES, "template id");
      if (id === "custom") bad("template id");
      return { id, label: nstr(t.label, "label", 80), channel_default: oneOf(t.channel_default, TASK_CHANNELS, "channel_default"), needs_pack: optStr(t.needs_pack, "needs_pack", 60), promotional: t.promotional === true, example_instruction: text(t.example_instruction, "example_instruction", 1500) };
    }),
  };
}

export type PlanInput = { taskId?: string; instruction: string; language?: TaskLang | null; contacts?: { name?: string | null; phone: string }[] };

export async function planTask(token: string, tenantId: string, input: PlanInput): Promise<TaskOut> {
  const body: Rec = { instruction: input.instruction };
  if (input.taskId) body.task_id = input.taskId;
  if (input.language) body.language = input.language;
  if (input.contacts && input.contacts.length > 0) body.contacts = input.contacts;
  return parseTask(await apiRequest(`${base(tenantId)}/plan`, token, { method: "POST", body: JSON.stringify(body) }));
}
export async function answerTask(token: string, tenantId: string, taskId: string, answer: string): Promise<TaskOut> {
  return parseTask(await apiRequest(taskPath(tenantId, taskId, "/answer"), token, { method: "POST", body: JSON.stringify({ answer }) }));
}
export async function getTask(token: string, tenantId: string, taskId: string): Promise<TaskOut> {
  return parseTask(await apiRequest(taskPath(tenantId, taskId), token));
}
export async function listTasks(token: string, tenantId: string, query: { status?: TaskStatus; limit?: number; before?: string } = {}): Promise<TaskOut[]> {
  const q = new URLSearchParams();
  if (query.status) q.set("status", query.status);
  if (query.limit) q.set("limit", String(Math.max(1, Math.min(100, Math.trunc(query.limit)))));
  if (query.before && !Number.isNaN(Date.parse(query.before))) q.set("before", query.before);
  const qs = q.toString();
  return parseTaskList(await apiRequest(`${base(tenantId)}${qs ? `?${qs}` : ""}`, token));
}
export async function getTaskContacts(token: string, tenantId: string, taskId: string, query: { status?: string; limit?: number; cursor?: string } = {}): Promise<TaskContactsOut> {
  const q = new URLSearchParams();
  if (query.status && (CONTACT_STATUSES as readonly string[]).includes(query.status)) q.set("status", query.status);
  if (query.limit) q.set("limit", String(Math.max(1, Math.min(200, Math.trunc(query.limit)))));
  if (query.cursor && /^\d{1,12}$/.test(query.cursor)) q.set("cursor", query.cursor);
  const qs = q.toString();
  return parseTaskContacts(await apiRequest(taskPath(tenantId, taskId, `/contacts${qs ? `?${qs}` : ""}`), token));
}
export async function excludeTaskContacts(token: string, tenantId: string, taskId: string, contactIds: readonly string[], excluded: boolean): Promise<TaskOut> {
  if (contactIds.some((c) => !isCanonicalUuid(c))) throw new ApiContractError("contact id");
  return parseTask(await apiRequest(taskPath(tenantId, taskId, "/contacts/exclude"), token, { method: "POST", body: JSON.stringify({ contact_ids: contactIds, excluded }) }));
}
export async function approveTask(token: string, tenantId: string, taskId: string, planSha256: string, capPaise?: number | null): Promise<TaskOut> {
  const body: Rec = { plan_sha256: planSha256 };
  if (capPaise !== undefined && capPaise !== null) body.cap_paise = capPaise;
  return parseTask(await apiRequest(taskPath(tenantId, taskId, "/approve"), token, { method: "POST", body: JSON.stringify(body) }));
}
export async function setTaskCap(token: string, tenantId: string, taskId: string, capPaise: number): Promise<TaskOut> {
  return parseTask(await apiRequest(taskPath(tenantId, taskId, "/cap"), token, { method: "POST", body: JSON.stringify({ cap_paise: capPaise }) }));
}
/** run (continue what is waiting), pause, resume, cancel: each a POST with no body. */
export async function moveTask(token: string, tenantId: string, taskId: string, verb: "run" | "pause" | "resume" | "cancel"): Promise<TaskOut> {
  return parseTask(await apiRequest(taskPath(tenantId, taskId, `/${verb}`), token, { method: "POST", body: JSON.stringify({}) }));
}
export async function getTaskReport(token: string, tenantId: string, taskId: string): Promise<ReportOut> {
  return parseReport(await apiRequest(taskPath(tenantId, taskId, "/report"), token));
}
export async function getTaskTemplates(token: string, tenantId: string): Promise<TemplatesOut> {
  return parseTemplates(await apiRequest(`${base(tenantId)}/templates`, token));
}

