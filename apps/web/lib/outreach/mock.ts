import { createHash } from "node:crypto";

import type { Batch, BatchAnswer, BatchInput, BatchItem, BatchPlan, BatchProgress, Handoff, OutreachReport, Policy, Rule, RuleInput, SourceRow } from "./types";
import { BATCH_STATUSES, CALL_LANGS, CHANNELS, GOALS, PAUSE_REASONS, RULE_ACTIONS, SOURCE_TAGS } from "./types";

/**
 * The FAKE of the speed-to-lead screens (OUTREACH_SCREENS=mock, job DR A3): batches and rules kept in ONE small cookie of the browser, everything else DERIVED from them so the cookie stays tiny and the same cookie always draws the same
 * screen: who is in a batch (made-up first names from the batch's own id), the estimate (the fake rates below, calculated here and never by a model), the progress (one person every three seconds since the approval), the hand-offs
 * and the report (a made-up week). Nothing is sent and nobody is called. Pure: the clock is a parameter.
 */
export const MOCK_COOKIE = "sme_outreach_mock";
export const FAKE_CALL_PAISE_PER_MINUTE = 400;
export const FAKE_MESSAGE_PAISE = 30;
export const MINUTES_PER_CALL = 3;
export const SECONDS_PER_PERSON = 3;
const NAMES = ["Ravi K.", "Anitha R.", "Kiran P.", "Lakshmi S.", "Suresh B.", "Meena V.", "Arjun T.", "Divya M.", "Harish N.", "Padma G.", "Venkat L.", "Sunita D."];
const CITIES = ["Hyderabad", "Nellore", "Guntur", "Warangal", "Tirupati"];

export type MockBatch = { id: string; name: string; goal: Batch["goal"]; channel: Batch["channel"]; language: Batch["language"]; source: string; questions: string[]; messageText: string | null; windowDays: number; maxCallsPerDay: number | null; maxTotalMinutes: number | null; createdAt: string; approvedAt: string | null; paused: boolean; cancelled: boolean; excluded: string[] };
export type MockRule = Omit<Rule, "usage" | "pausedReason"> & { pausedReason: Rule["pausedReason"] };
export type MockState = { batches: MockBatch[]; rules: MockRule[]; acted: string[] };
export const EMPTY: MockState = { batches: [], rules: [], acted: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): v is T => typeof v === "string" && (all as readonly string[]).includes(v);
const strs = (v: unknown, max: number): string[] | null => (Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= 300) ? (v as string[]) : null);
const capOf = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie as the browser sent it: every part checked, what is not right is dropped (never trusted). */
export function parse(value: unknown): MockState | null {
  if (!isObj(value)) return null;
  const batches: MockBatch[] = [];
  for (const b of Array.isArray(value.batches) ? value.batches.slice(0, 6) : []) {
    if (!isObj(b) || typeof b.id !== "string" || !UUID.test(b.id) || typeof b.name !== "string" || b.name.length > 200 || !oneOf(b.goal, GOALS) || !oneOf(b.channel, CHANNELS) || !oneOf(b.language, CALL_LANGS) || typeof b.source !== "string" || b.source.length > 40) continue;
    const q = strs(b.questions, 8);
    const ex = strs(b.excluded, 40);
    const caps = [capOf(b.maxCallsPerDay), capOf(b.maxTotalMinutes)];
    if (!q || !ex || caps.includes(undefined) || typeof b.createdAt !== "string" || (b.approvedAt !== null && typeof b.approvedAt !== "string") || typeof b.windowDays !== "number") continue;
    batches.push({ id: b.id, name: b.name, goal: b.goal, channel: b.channel, language: b.language, source: b.source, questions: q, messageText: typeof b.messageText === "string" ? b.messageText.slice(0, 700) : null, windowDays: Math.min(14, Math.max(1, Math.round(b.windowDays))), maxCallsPerDay: caps[0] as number | null, maxTotalMinutes: caps[1] as number | null, createdAt: b.createdAt, approvedAt: b.approvedAt as string | null, paused: b.paused === true, cancelled: b.cancelled === true, excluded: ex });
  }
  const rules: MockRule[] = [];
  for (const r of Array.isArray(value.rules) ? value.rules.slice(0, 6) : []) {
    if (!isObj(r) || typeof r.id !== "string" || !UUID.test(r.id) || !oneOf(r.source, SOURCE_TAGS) || !oneOf(r.action, RULE_ACTIONS) || !oneOf(r.goal, GOALS) || !oneOf(r.channel, CHANNELS) || !oneOf(r.language, CALL_LANGS) || typeof r.withinMinutes !== "number") continue;
    const q = strs(r.questions, 8);
    const caps = [capOf(r.maxCallsPerDay), capOf(r.maxTotalMinutes)];
    if (!q || caps.includes(undefined) || typeof r.approvedAt !== "string") continue;
    rules.push({ id: r.id, source: r.source, action: r.action, withinMinutes: Math.min(120, Math.max(1, Math.round(r.withinMinutes))), goal: r.goal, channel: r.channel, language: r.language, questions: q, messageText: typeof r.messageText === "string" ? r.messageText.slice(0, 700) : null, maxCallsPerDay: caps[0] as number | null, maxTotalMinutes: caps[1] as number | null, active: r.active !== false, pausedReason: oneOf(r.pausedReason, PAUSE_REASONS) ? r.pausedReason : null, approvedAt: r.approvedAt });
  }
  return { batches, rules, acted: strs(value.acted, 20) ?? [] };
}

/** A number from an id: the same id is always the same plan. */
export const seedOf = (id: string): number => parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16);
/** A made-up contact id from the batch id and a number (the same each time). */
export const contactId = (batchId: string, n: number): string => `${batchId.slice(0, 24)}${String(n).padStart(12, "0")}`;

function sizes(b: MockBatch) {
  const seed = seedOf(b.id);
  const count = 8 + (seed % 33);
  const noConsent = seed % 3;
  const stopped = (seed >> 3) % 2;
  const excluded = b.excluded.length;
  const ready = Math.max(0, count - noConsent - stopped - excluded);
  return { count, noConsent, stopped, ready };
}

export function planOf(b: MockBatch): BatchPlan {
  const { count, noConsent, stopped, ready } = sizes(b);
  const seed = seedOf(b.id);
  const minutes = b.channel === "whatsapp" ? 0 : ready * MINUTES_PER_CALL;
  const messages = b.channel === "call" ? 0 : ready;
  const created = new Date(b.createdAt);
  const to = new Date(created.getTime() + b.windowDays * 86_400_000);
  return {
    count,
    ready,
    skipped: { ...(noConsent ? { no_consent: noConsent } : {}), ...(stopped ? { stopped } : {}) },
    sample: [0, 1, 2].map((i) => ({ contactId: contactId(b.id, i + 1), nameMasked: NAMES[(seed + i * 5) % NAMES.length], city: CITIES[(seed + i) % CITIES.length] })),
    windowFrom: created.toISOString().slice(0, 10),
    windowTo: to.toISOString().slice(0, 10),
    estimatedMinutes: minutes,
    estimatedMessages: messages,
    estimatedCostPaise: minutes * FAKE_CALL_PAISE_PER_MINUTE + messages * FAKE_MESSAGE_PAISE,
    maxCallsPerDay: b.maxCallsPerDay,
    maxTotalMinutes: b.maxTotalMinutes,
  };
}

export const planHash = (b: MockBatch): string => createHash("sha256").update(JSON.stringify([b.id, b.goal, b.channel, b.language, b.questions, b.messageText, b.windowDays, b.maxCallsPerDay, b.maxTotalMinutes, [...b.excluded].sort()])).digest("hex");

export function progressOf(b: MockBatch, now: Date): BatchProgress | null {
  if (!b.approvedAt) return null;
  const { ready } = sizes(b);
  const done = Math.min(ready, Math.floor((now.getTime() - new Date(b.approvedAt).getTime()) / 1000 / SECONDS_PER_PERSON));
  const calls = b.channel === "whatsapp" ? 0 : done;
  return { total: ready, waiting: ready - done, done, callsMade: calls, connected: Math.round(calls * 0.6), interested: Math.round(done * 0.25), minutesUsed: calls * MINUTES_PER_CALL };
}

export function batchOf(b: MockBatch, now: Date): Batch {
  const p = progressOf(b, now);
  const finished = p !== null && p.waiting === 0 && !b.cancelled;
  const status: Batch["status"] = b.cancelled ? "cancelled" : !b.approvedAt ? "planned" : b.paused ? "paused" : finished ? "done" : "running";
  return {
    id: b.id,
    name: b.name,
    status: BATCH_STATUSES.includes(status) ? status : "planned",
    pausedReason: status === "paused" ? "owner" : null,
    goal: b.goal,
    channel: b.channel,
    language: b.language,
    questions: b.questions,
    messageText: b.messageText,
    windowDays: b.windowDays,
    maxCallsPerDay: b.maxCallsPerDay,
    maxTotalMinutes: b.maxTotalMinutes,
    planSha256: planHash(b),
    createdAt: b.createdAt,
    approvedAt: b.approvedAt,
    finishedAt: finished ? new Date(new Date(b.approvedAt as string).getTime() + sizes(b).ready * SECONDS_PER_PERSON * 1000).toISOString() : null,
  };
}

export const answerOf = (b: MockBatch, now: Date): BatchAnswer => ({ batch: batchOf(b, now), plan: planOf(b), progress: progressOf(b, now) });

export function itemsOf(b: MockBatch, now: Date): BatchItem[] {
  const { count, noConsent, stopped } = sizes(b);
  const p = progressOf(b, now);
  const seed = seedOf(b.id);
  let readyIndex = 0;
  return Array.from({ length: Math.min(count, 50) }, (_, i) => {
    const cid = contactId(b.id, i + 1);
    const skip = b.excluded.includes(cid) ? "excluded" : i < noConsent ? "no_consent" : i < noConsent + stopped ? "stopped" : null;
    const base = { id: contactId(b.id, 100 + i), contactId: cid, leadId: null, name: NAMES[(seed + i * 5) % NAMES.length], nextAt: null };
    if (skip) return { ...base, status: "skipped" as const, reason: skip, attempts: 0, nextAction: null, lastResult: null };
    const done = p !== null && readyIndex < p.done;
    readyIndex += 1;
    return { ...base, status: done ? ("done" as const) : p ? ("waiting" as const) : ("planned" as const), reason: null, attempts: done ? 1 : 0, nextAction: done ? null : b.channel === "whatsapp" ? ("whatsapp" as const) : ("call" as const), lastResult: done ? (readyIndex % 3 === 0 ? "no_answer" : "connected") : null };
  });
}

export function ruleOf(r: MockRule, now: Date): Rule {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(r.approvedAt).getTime()) / 86_400_000));
  return { ...r, usage: { leads: seedOf(r.id) % 9 + days, callsToday: seedOf(r.id) % 4, minutesUsed: (seedOf(r.id) % 9) * MINUTES_PER_CALL } };
}

export function newRule(input: RuleInput, now: Date): MockRule {
  return { id: input.ruleId, source: input.source, action: input.action, withinMinutes: input.withinMinutes, goal: input.goal, channel: input.channel, language: input.language, questions: [...input.questions], messageText: input.messageText, maxCallsPerDay: input.maxCallsPerDay, maxTotalMinutes: input.maxTotalMinutes, active: true, pausedReason: null, approvedAt: now.toISOString() };
}

export function newBatch(input: BatchInput, now: Date): MockBatch {
  const source = input.who.kind === "source" ? input.who.source : input.who.kind;
  return { id: input.batchId, name: input.name, goal: input.goal, channel: input.channel, language: input.language, source, questions: [...input.questions], messageText: input.messageText, windowDays: input.windowDays, maxCallsPerDay: input.maxCallsPerDay, maxTotalMinutes: input.maxTotalMinutes, createdAt: now.toISOString(), approvedAt: null, paused: false, cancelled: false, excluded: [] };
}

/** Two hot leads waiting, from the clock's day (the same each day); the ones the person marked done are not listed when `open`. */
export function handoffsOf(state: MockState, assignedTo: string, now: Date, open: boolean): Handoff[] {
  const day = now.toISOString().slice(0, 10);
  const all: Handoff[] = [
    { id: `00000000-0000-4000-8000-0000000000a1`, leadId: null, contactId: `00000000-0000-4000-8000-0000000000b1`, contactName: "Ravi K.", summary: "Wants to see the site on Saturday morning. Budget around 60 lakh. Asked for the brochure on WhatsApp.", assignedTo, notifiedAt: `${day}T05:10:00.000Z`, reminderSentAt: null, actedAt: null },
    { id: `00000000-0000-4000-8000-0000000000a2`, leadId: null, contactId: `00000000-0000-4000-8000-0000000000b2`, contactName: "Anitha R.", summary: "Interested in the two-bedroom. Will decide after her husband sees it. Call back tomorrow after 5 pm.", assignedTo, notifiedAt: `${day}T04:40:00.000Z`, reminderSentAt: `${day}T04:55:00.000Z`, actedAt: null },
  ].map((h) => (state.acted.includes(h.id) ? { ...h, actedAt: now.toISOString() } : h));
  return open ? all.filter((h) => h.actedAt === null) : all;
}

const ROWS: Omit<SourceRow, "leadCostPaise" | "callCostPaise" | "costPerBookingPaise">[] = [
  { source: "meta_lead_ads", leads: 120, firstTouchMedianSeconds: 96, calls: 140, connectedRate: 61, interestedPct: 24, bookings: 14 },
  { source: "indiamart", leads: 64, firstTouchMedianSeconds: 140, calls: 72, connectedRate: 55, interestedPct: 31, bookings: 9 },
  { source: "website_form", leads: 38, firstTouchMedianSeconds: 75, calls: 41, connectedRate: 66, interestedPct: 27, bookings: 6 },
];
const LEAD_COST: Record<string, number> = { meta_lead_ads: 9000, indiamart: 15000, website_form: 0 };

/** A made-up week, clearly sample numbers (the screen says "test data"). */
export function reportOf(from: string, to: string): OutreachReport {
  const bySource: SourceRow[] = ROWS.map((r) => {
    const callCost = r.calls * MINUTES_PER_CALL * FAKE_CALL_PAISE_PER_MINUTE;
    const leadCost = r.leads * (LEAD_COST[r.source] ?? 0);
    return { ...r, callCostPaise: callCost, leadCostPaise: leadCost, costPerBookingPaise: r.bookings > 0 ? Math.round((callCost + leadCost) / r.bookings) : null };
  });
  const sum = (f: (r: SourceRow) => number) => bySource.reduce((a, r) => a + f(r), 0);
  const calls = sum((r) => r.calls);
  const bookings = sum((r) => r.bookings);
  const leads = sum((r) => r.leads);
  const callCost = sum((r) => r.callCostPaise);
  const leadCost = sum((r) => r.leadCostPaise);
  return { fromDay: from, toDay: to, bySource, total: { leads, calls, connectedRate: Math.round(bySource.reduce((a, r) => a + r.connectedRate * r.calls, 0) / calls), interestedPct: Math.round(bySource.reduce((a, r) => a + r.interestedPct * r.leads, 0) / leads), bookings, callCostPaise: callCost, leadCostPaise: leadCost, costPerBookingPaise: bookings > 0 ? Math.round((callCost + leadCost) / bookings) : null } };
}

export const MOCK_POLICY: Policy = { nightCallMinute: 570, maxAttempts: 3, retryGapHours: 18, thenWhatsapp: true, whatsappAfterHours: true, handoffReminderMinutes: 15, callPaisePerMinute: FAKE_CALL_PAISE_PER_MINUTE, hours: { days: [1, 2, 3, 4, 5, 6], fromMinute: 540, toMinute: 1140, from: "default" }, saved: false };
