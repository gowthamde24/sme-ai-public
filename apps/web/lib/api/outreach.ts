import { CALL_LANGS } from "@/lib/assistant/types";
import { BATCH_STATUSES, CHANNELS, GOALS, PAUSE_REASONS, RULE_ACTIONS, type RetryStep, type RuleLang, type RuleStep, type RuleTemplate, type Batch, type BatchAnswer, type BatchInput, type BatchItem, type BatchPlan, type BatchProgress, type Handoff, type OutreachReport, type Policy, type Rule, type RuleInput, type SourceRow } from "@/lib/outreach/types";

import { parseSpeedRules, speedRulesBody, type SpeedRules } from "@/lib/outreach/speed";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, counts, readRows, word, int, iso, isRec, list, oneOf, optInt, optIso, optStr, rec, str, uuid, bool } from "./shape";

/**
 * The speed-to-lead part of the API (night 4, part A3; contract-speed-approvals.md, generated packages/contracts/outreach.ts): batch plans with ONE approval, standing rules per lead source, hand-offs, the calling policy and the
 * lead report. Under `/v1/tenants/{id}/outreach`. SERVER ONLY, with the signed-in person's own token. Every answer is read with the checks of lib/api/shape.ts: what is not the contract's shape is an error, never drawn.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/outreach`;
};
const id = (v: unknown, what: string): string => (typeof v === "string" && isCanonicalUuid(v) ? v : bad(what));
const lang = (v: unknown, what: string) => oneOf(v, CALL_LANGS, what);
const RULE_LANGS = [...CALL_LANGS, "auto"] as const;
const ruleLang = (v: unknown, what: string): RuleLang => oneOf(v, RULE_LANGS, what);
/** A template is named, never written: the name of one of the workspace's WhatsApp templates (C1 docs/plans/speed-to-lead-rules-v2.md). */
const tplName = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : typeof v === "string" && /^[a-z0-9_]{1,64}$/.test(v) ? v : bad(what));
/** What the API prints of a rule's plan: the call, the retries, then the WhatsApp template. Anything else makes the plan unreadable (null): the screen then builds it from the policy. */
const planSteps = (v: unknown): RuleStep[] | null => {
  if (!isRec(v) || !Array.isArray(v.steps)) return null;
  const out: RuleStep[] = [];
  for (const raw of v.steps.slice(0, 12)) {
    if (!isRec(raw)) return null;
    if (raw.kind === "call" && typeof raw.minutes === "number" && Number.isInteger(raw.minutes) && raw.minutes >= 0 && raw.minutes <= 120) out.push({ kind: "call", minutes: raw.minutes });
    else if (raw.kind === "retry" && typeof raw.after_minutes === "number" && Number.isInteger(raw.after_minutes) && raw.after_minutes >= 1 && raw.after_minutes <= 4320) out.push({ kind: "retry", afterMinutes: raw.after_minutes });
    else if (raw.kind === "retry" && typeof raw.next_morning === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.next_morning)) out.push({ kind: "retry", nextMorning: raw.next_morning });
    else if (raw.kind === "whatsapp" && typeof raw.template === "string" && /^[a-z0-9_]{1,64}$/.test(raw.template)) out.push({ kind: "whatsapp", template: raw.template });
    else return null;
  }
  return out.length > 0 ? out : null;
};
const strings = (v: unknown, what: string, max = 20): string[] => list(v ?? [], what, max).map((x) => str(x, what, 300));

export function parsePlan(json: unknown): BatchPlan {
  const x = rec(json, "plan");
  const window = isRec(x.window) ? x.window : {};
  const caps = isRec(x.caps) ? x.caps : {};
  const capOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
  return {
    count: int(x.count, "count", 0, 1_000_000),
    ready: int(x.ready, "ready", 0, 1_000_000),
    skipped: counts(x.skipped ?? {}, "skipped"),
    sample: list(x.sample ?? [], "sample", 20).map((row) => {
      const r = rec(row, "sample");
      return { contactId: id(r.contact_id, "contact_id"), nameMasked: str(r.name_masked, "name_masked", 80), city: optStr(r.city, "city", 80) };
    }),
    windowFrom: typeof window.from === "string" ? window.from.slice(0, 40) : null,
    windowTo: typeof window.to === "string" ? window.to.slice(0, 40) : null,
    estimatedMinutes: int(x.estimated_minutes, "estimated_minutes", 0, 10_000_000),
    estimatedMessages: int(x.estimated_messages, "estimated_messages", 0, 10_000_000),
    estimatedCostPaise: int(x.estimated_cost_paise, "estimated_cost_paise", 0, 100_000_000_000),
    maxCallsPerDay: capOf(caps.max_calls_per_day),
    maxTotalMinutes: capOf(caps.max_total_minutes),
  };
}

export function parseProgress(json: unknown): BatchProgress {
  const x = rec(json, "progress");
  return { total: int(x.total, "total"), waiting: int(x.waiting, "waiting"), done: int(x.done, "done"), callsMade: int(x.calls_made, "calls_made"), connected: int(x.connected, "connected"), interested: int(x.interested, "interested"), minutesUsed: minutes(x.minutes_used, "minutes_used"), ...(x.visits_booked !== undefined ? { visitsBooked: optInt(x.visits_booked, "visits_booked") } : {}), ...(x.quotes_paise !== undefined ? { quotesPaise: optInt(x.quotes_paise, "quotes_paise") } : {}) };
}

export function parseBatch(json: unknown): Batch {
  const x = rec(json, "batch");
  return {
    id: id(x.id, "id"),
    name: str(x.name, "name", 200),
    status: oneOf(x.status, BATCH_STATUSES, "status"),
    pausedReason: x.paused_reason === null || x.paused_reason === undefined ? null : oneOf(x.paused_reason, PAUSE_REASONS, "paused_reason"),
    goal: oneOf(x.goal, GOALS, "goal"),
    channel: oneOf(x.channel, CHANNELS, "channel"),
    language: lang(x.language, "language"),
    questions: strings(x.questions, "questions", 8),
    messageText: optStr(x.message_text, "message_text", 700),
    windowDays: int(x.window_days, "window_days", 1, 14),
    maxCallsPerDay: optInt(x.max_calls_per_day, "max_calls_per_day"),
    maxTotalMinutes: optInt(x.max_total_minutes, "max_total_minutes"),
    planSha256: str(x.plan_sha256, "plan_sha256", 128),
    createdAt: iso(x.created_at, "created_at"),
    approvedAt: optIso(x.approved_at, "approved_at"),
    finishedAt: optIso(x.finished_at, "finished_at"),
  };
}

export function parseBatchAnswer(json: unknown): BatchAnswer {
  const x = rec(json, "batch answer");
  return { batch: parseBatch(x.batch), plan: parsePlan(x.plan), progress: x.progress === null || x.progress === undefined ? null : parseProgress(x.progress) };
}

export function parseItems(json: unknown): { items: BatchItem[]; nextCursor: string | null } {
  const x = rec(json, "items");
  return {
    items: list(x.items, "items", 200).map((row) => {
      const r = rec(row, "item");
      return {
        id: id(r.id, "id"),
        contactId: id(r.contact_id, "contact_id"),
        leadId: r.lead_id === null || r.lead_id === undefined ? null : id(r.lead_id, "lead_id"),
        name: str(r.name, "name", 200),
        status: oneOf(r.status, ["planned", "waiting", "done", "stopped", "skipped"] as const, "status"),
        reason: optStr(r.reason, "reason", 80),
        attempts: int(r.attempts, "attempts", 0, 100),
        nextAction: r.next_action === null || r.next_action === undefined ? null : oneOf(r.next_action, ["call", "whatsapp"] as const, "next_action"),
        nextAt: optIso(r.next_at, "next_at"),
        lastResult: optStr(r.last_result, "last_result", 80),
      };
    }),
    nextCursor: optStr(x.next_cursor, "next_cursor", 300),
  };
}

/** Minutes of calling: the API counts in fractions (a 30 second call is 0.5), so a whole number is not the contract; shown to one decimal. */
const minutes = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? Math.round(v * 10) / 10 : bad(what));

export function parseRule(json: unknown): Rule {
  const x = rec(json, "rule");
  const u = rec(x.usage ?? { leads: 0, calls_today: 0, minutes_used: 0 }, "usage");
  return {
    id: id(x.id, "id"),
    source: str(x.source, "source", 40),
    action: oneOf(x.action, RULE_ACTIONS, "action"),
    withinMinutes: int(x.within_minutes, "within_minutes", 0, 120),
    goal: oneOf(x.goal, GOALS, "goal"),
    channel: oneOf(x.channel, CHANNELS, "channel"),
    language: ruleLang(x.language, "language"),
    questions: strings(x.questions, "questions", 8),
    waFirstTemplate: tplName(x.wa_first_template, "wa_first_template"),
    waMissedTemplate: tplName(x.wa_missed_template, "wa_missed_template"),
    warnings: x.warnings === undefined || x.warnings === null ? [] : strings(x.warnings, "warnings", 8),
    steps: planSteps(x.plan),
    maxCallsPerDay: optInt(x.max_calls_per_day, "max_calls_per_day"),
    maxTotalMinutes: optInt(x.max_total_minutes, "max_total_minutes"),
    active: bool(x.active, "active"),
    pausedReason: x.paused_reason === null || x.paused_reason === undefined ? null : oneOf(x.paused_reason, PAUSE_REASONS, "paused_reason"),
    approvedAt: iso(x.approved_at, "approved_at"),
    usage: { leads: int(u.leads, "leads"), callsToday: int(u.calls_today, "calls_today"), minutesUsed: minutes(u.minutes_used, "minutes_used") },
  };
}

/**
 * A rule as the LIST reads it: a value that is not the contract's (an unknown source, a number the web did not expect) does not make the list unreadable. That field is named in `unreadable`, the screen draws "—" for it,
 * and the server logs it. Only a row without a readable id is left out (readRows logs that). Writes (create, pause, resume, caps) keep the strict parseRule.
 */
export function parseRuleRow(json: unknown): Rule {
  const x = rec(json, "rule");
  const unreadable: string[] = [];
  const get = <T,>(name: string, read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      unreadable.push(name);
      return fallback;
    }
  };
  const u = isRec(x.usage) ? x.usage : x.usage === undefined ? { leads: 0, calls_today: 0, minutes_used: 0 } : null;
  const usage = get("usage", () => (u ? { leads: int(u.leads, "leads"), callsToday: int(u.calls_today, "calls_today"), minutesUsed: minutes(u.minutes_used, "minutes_used") } : bad("usage")), { leads: 0, callsToday: 0, minutesUsed: 0 });
  const rule: Rule = {
    id: id(x.id, "id"),
    source: get("source", () => str(x.source, "source", 40), ""),
    action: get("action", () => oneOf(x.action, RULE_ACTIONS, "action"), "call_within_minutes"),
    withinMinutes: get("within_minutes", () => int(x.within_minutes, "within_minutes", 0, 120), 0),
    goal: get("goal", () => oneOf(x.goal, GOALS, "goal"), "general"),
    channel: get("channel", () => oneOf(x.channel, CHANNELS, "channel"), "call"),
    language: get("language", () => ruleLang(x.language, "language"), "auto"),
    questions: get("questions", () => strings(x.questions, "questions", 8), []),
    waFirstTemplate: get("wa_first_template", () => tplName(x.wa_first_template, "wa_first_template"), null),
    waMissedTemplate: get("wa_missed_template", () => tplName(x.wa_missed_template, "wa_missed_template"), null),
    warnings: get("warnings", () => (x.warnings === undefined || x.warnings === null ? [] : strings(x.warnings, "warnings", 8)), []),
    steps: planSteps(x.plan),
    maxCallsPerDay: get("max_calls_per_day", () => optInt(x.max_calls_per_day, "max_calls_per_day"), null),
    maxTotalMinutes: get("max_total_minutes", () => optInt(x.max_total_minutes, "max_total_minutes"), null),
    active: get("active", () => bool(x.active, "active"), false),
    pausedReason: get("paused_reason", () => (x.paused_reason === null || x.paused_reason === undefined ? null : oneOf(x.paused_reason, PAUSE_REASONS, "paused_reason")), null),
    approvedAt: get("approved_at", () => iso(x.approved_at, "approved_at"), ""),
    usage,
  };
  if (unreadable.length > 0) {
    console.error("API rules: a rule has values that are not the contract's; shown as a dash:", rule.id, unreadable.join(", "));
    return { ...rule, unreadable };
  }
  return rule;
}

export function parseHandoffs(json: unknown): Handoff[] {
  const rows = Array.isArray(json) ? json : bad("handoffs");
  return readRows(rows, "handoffs", (row) => {
    const r = rec(row, "handoff");
    return {
      id: id(r.id, "id"),
      leadId: r.lead_id === null || r.lead_id === undefined ? null : id(r.lead_id, "lead_id"),
      contactId: id(r.contact_id, "contact_id"),
      contactName: str(r.contact_name, "contact_name", 200),
      summary: str(r.summary, "summary", 500),
      assignedTo: uuid(r.assigned_to, "assigned_to"),
      notifiedAt: iso(r.notified_at, "notified_at"),
      reminderSentAt: optIso(r.reminder_sent_at, "reminder_sent_at"),
      actedAt: optIso(r.acted_at, "acted_at"),
    };
  });
}

const rate = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : bad(what));
function parseRow(json: unknown, withSource: true): SourceRow;
function parseRow(json: unknown, withSource: false): Omit<SourceRow, "source" | "firstTouchMedianSeconds">;
function parseRow(json: unknown, withSource: boolean): unknown {
  const r = rec(json, "report row");
  const body = {
    leads: int(r.leads, "leads"),
    calls: int(r.calls, "calls"),
    connectedRate: rate(r.connected_rate, "connected_rate"),
    interestedPct: rate(r.interested_pct, "interested_pct"),
    bookings: int(r.bookings, "bookings"),
    callCostPaise: int(r.call_cost_paise, "call_cost_paise", 0, 100_000_000_000),
    leadCostPaise: int(r.lead_cost_paise, "lead_cost_paise", 0, 100_000_000_000),
    costPerBookingPaise: optInt(r.cost_per_booking_paise, "cost_per_booking_paise", 0, 100_000_000_000),
    // Track D (contract lead-sources-v2.md e): the visits booked from this source's leads and what a lead and a visit cost; test leads are left out by the API. Absent on an older API.
    visits: optInt(r.visits, "visits", 0, 10_000_000),
    costPerLeadPaise: optInt(r.cost_per_lead_paise, "cost_per_lead_paise", 0, 100_000_000_000),
    spendPaise: optInt(r.spend_paise, "spend_paise", 0, 100_000_000_000),
    costPerVisitPaise: optInt(r.cost_per_visit_paise, "cost_per_visit_paise", 0, 100_000_000_000),
  };
  return withSource ? { source: str(r.source, "source", 40), firstTouchMedianSeconds: optInt(r.first_touch_median_seconds, "first_touch_median_seconds", 0, 10_000_000), ...body } : body;
}

export function parseReport(json: unknown): OutreachReport {
  const x = rec(json, "report");
  return { fromDay: str(x.from_day, "from_day", 10), toDay: str(x.to_day, "to_day", 10), bySource: list(x.by_source, "by_source", 50).map((r) => parseRow(r, true)), total: parseRow(x.total, false) };
}

/** The policy's retry steps for a lead who does not answer (after N minutes, or the next morning at a minute of the day); absent or odd = null, and the screen says only what it knows. */
const retrySteps = (v: unknown): RetryStep[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return null;
  const out: RetryStep[] = [];
  for (const raw of v) {
    if (!isRec(raw)) return null;
    if (typeof raw.after_minutes === "number" && Number.isInteger(raw.after_minutes) && raw.after_minutes >= 1 && raw.after_minutes <= 4320) out.push({ afterMinutes: raw.after_minutes });
    else if (typeof raw.next_morning_minute === "number" && Number.isInteger(raw.next_morning_minute) && raw.next_morning_minute >= 0 && raw.next_morning_minute <= 1439) out.push({ nextMorningMinute: raw.next_morning_minute });
    else return null;
  }
  return out;
};

export function parseTemplate(json: unknown): RuleTemplate {
  const x = rec(json, "template");
  return {
    key: word(x.key, "key", 64),
    moment: oneOf(x.moment, ["first", "missed"] as const, "moment"),
    label: str(x.label, "label", 120),
    language: str(x.language, "language", 8),
    status: oneOf(x.status, ["approved", "submitted", "draft", "missing"] as const, "status"),
    preview: str(x.preview, "preview", 1200),
    variables: strings(x.variables, "variables", 8),
  };
}

export function parsePolicy(json: unknown): Policy {
  const x = rec(json, "policy");
  const h = rec(x.hours, "hours");
  return {
    nightCallMinute: int(x.night_call_minute, "night_call_minute", 0, 1439),
    maxAttempts: int(x.max_attempts, "max_attempts", 1, 6),
    retryGapHours: int(x.retry_gap_hours, "retry_gap_hours", 1, 48),
    thenWhatsapp: bool(x.then_whatsapp, "then_whatsapp"),
    whatsappAfterHours: bool(x.whatsapp_after_hours, "whatsapp_after_hours"),
    handoffReminderMinutes: int(x.handoff_reminder_minutes, "handoff_reminder_minutes", 1, 600),
    callPaisePerMinute: int(x.call_paise_per_minute, "call_paise_per_minute", 0, 100_000),
    hours: { days: list(h.days, "days", 7).map((d) => int(d, "day", 1, 7)), fromMinute: int(h.from_minute, "from_minute", 0, 1439), toMinute: int(h.to_minute, "to_minute", 0, 1440), from: oneOf(h.from, ["assistant", "call_settings", "default"] as const, "hours.from") },
    retrySteps: retrySteps(x.retry_steps),
    saved: x.saved === true,
  };
}

const whoBody = (w: BatchInput["who"]): unknown => (w.kind === "contacts" ? { contact_ids: w.ids } : w.kind === "leads" ? { lead_ids: w.ids } : { source: { source: w.source, status: w.status, since: w.since } });

export function batchBody(b: BatchInput): Record<string, unknown> {
  return { batch_id: b.batchId, name: b.name, goal: b.goal, channel: b.channel, language: b.language, who: whoBody(b.who), questions: b.questions, message_text: b.messageText, window_days: b.windowDays, max_calls_per_day: b.maxCallsPerDay, max_total_minutes: b.maxTotalMinutes };
}
export function ruleBody(r: RuleInput): Record<string, unknown> {
  return { rule_id: r.ruleId, source: r.source, action: r.action, within_minutes: r.withinMinutes, goal: r.goal, channel: r.channel, language: r.language, questions: r.questions, wa_first_template: r.waFirstTemplate, wa_missed_template: r.waMissedTemplate, max_calls_per_day: r.maxCallsPerDay, max_total_minutes: r.maxTotalMinutes };
}

const post = (tenantId: string, path: string, token: string, body: unknown = {}) => apiRequest(`${base(tenantId)}${path}`, token, { method: "POST", body: JSON.stringify(body) });
const put = (tenantId: string, path: string, token: string, body: unknown) => apiRequest(`${base(tenantId)}${path}`, token, { method: "PUT", body: JSON.stringify(body) });
const segment = (v: string): string => (isCanonicalUuid(v) ? v : bad("id"));

export const planBatch = async (token: string, tenantId: string, input: BatchInput): Promise<BatchAnswer> => parseBatchAnswer(await post(tenantId, "/batches", token, batchBody(input)));
export const listBatches = async (token: string, tenantId: string, status?: string): Promise<BatchAnswer[]> => {
  const rows = await apiRequest(`${base(tenantId)}/batches${status ? `?status=${encodeURIComponent(status)}` : ""}`, token);
  return readRows(Array.isArray(rows) ? rows : bad("batches"), "batches", parseBatchAnswer, 100);
};
export const getBatch = async (token: string, tenantId: string, batchId: string): Promise<BatchAnswer> => parseBatchAnswer(await apiRequest(`${base(tenantId)}/batches/${segment(batchId)}`, token));
export const getBatchItems = async (token: string, tenantId: string, batchId: string, cursor?: string | null) => parseItems(await apiRequest(`${base(tenantId)}/batches/${segment(batchId)}/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, token));
export const excludeFromBatch = async (token: string, tenantId: string, batchId: string, contactIds: readonly string[]): Promise<BatchAnswer> => parseBatchAnswer(await post(tenantId, `/batches/${segment(batchId)}/exclude`, token, { contact_ids: contactIds }));
export const approveBatch = async (token: string, tenantId: string, batchId: string, planSha256: string): Promise<BatchAnswer> => parseBatchAnswer(await post(tenantId, `/batches/${segment(batchId)}/approve`, token, { plan_sha256: planSha256 }));
export const batchAction = async (token: string, tenantId: string, batchId: string, action: "pause" | "resume" | "cancel"): Promise<BatchAnswer> => parseBatchAnswer(await post(tenantId, `/batches/${segment(batchId)}/${action}`, token));
export const setBatchCaps = async (token: string, tenantId: string, batchId: string, caps: { maxCallsPerDay?: number | null; maxTotalMinutes?: number | null }): Promise<BatchAnswer> => parseBatchAnswer(await put(tenantId, `/batches/${segment(batchId)}/caps`, token, { max_calls_per_day: caps.maxCallsPerDay ?? null, max_total_minutes: caps.maxTotalMinutes ?? null }));

export const listRules = async (token: string, tenantId: string): Promise<Rule[]> => {
  const got = await apiRequest(`${base(tenantId)}/rules`, token);
  const rows = Array.isArray(got) ? got : isRec(got) && Array.isArray(got.items) ? got.items : bad("rules");
  return readRows(rows, "rules", parseRuleRow, 100);
};
/** `GET /outreach/rule-templates` (C1, 15 Nov): the WhatsApp messages a rule may name, each with its status for the business language and a preview filled with sample values. A row that is not the contract's is left out. */
export const listRuleTemplates = async (token: string, tenantId: string): Promise<RuleTemplate[]> => {
  const got = await apiRequest(`${base(tenantId)}/rule-templates`, token);
  return readRows(isRec(got) ? got.items : bad("templates"), "rule-templates", parseTemplate, 20);
};
export const createRule = async (token: string, tenantId: string, input: RuleInput): Promise<Rule> => parseRule(await post(tenantId, "/rules", token, ruleBody(input)));
export const ruleAction = async (token: string, tenantId: string, ruleId: string, action: "pause" | "resume"): Promise<Rule> => parseRule(await post(tenantId, `/rules/${segment(ruleId)}/${action}`, token));
export const setRuleCaps = async (token: string, tenantId: string, ruleId: string, caps: { maxCallsPerDay?: number | null; maxTotalMinutes?: number | null }): Promise<Rule> => parseRule(await put(tenantId, `/rules/${segment(ruleId)}/caps`, token, { max_calls_per_day: caps.maxCallsPerDay ?? null, max_total_minutes: caps.maxTotalMinutes ?? null }));

export const listHandoffs = async (token: string, tenantId: string, open = true): Promise<Handoff[]> => parseHandoffs(await apiRequest(`${base(tenantId)}/handoffs?open=${open ? "true" : "false"}`, token));
export const markHandoffActed = async (token: string, tenantId: string, handoffId: string): Promise<void> => void (await post(tenantId, `/handoffs/${segment(handoffId)}/acted`, token));
export const getOutreachReport = async (token: string, tenantId: string, from: string, to: string): Promise<OutreachReport> => parseReport(await apiRequest(`${base(tenantId)}/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token));
export const getPolicy = async (token: string, tenantId: string): Promise<Policy> => parsePolicy(await apiRequest(`${base(tenantId)}/policy`, token));
export const putSourceCosts = async (token: string, tenantId: string, costs: readonly { source: string; costPerLeadPaise: number }[]): Promise<void> => void (await put(tenantId, "/source-costs", token, { costs: costs.map((c) => ({ source: c.source, cost_per_lead_paise: c.costPerLeadPaise })) }));

/** Speed to lead as one rule per source (contract lead-sources-v2.md d). The write is sensitive: the API asks the second factor, as for the policy. */
export const getSpeedRules = async (token: string, tenantId: string): Promise<SpeedRules> => {
  const rules = parseSpeedRules(await apiRequest(`${base(tenantId)}/speed-to-lead`, token));
  return rules ?? bad("speed-to-lead");
};
export const putSpeedRules = async (token: string, tenantId: string, rules: SpeedRules): Promise<SpeedRules> => parseSpeedRules(await put(tenantId, "/speed-to-lead", token, speedRulesBody(rules))) ?? rules;
