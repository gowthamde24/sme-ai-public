import { CALL_LANGS, CHANNELS, GOALS, RULE_ACTIONS, RULE_SOURCES, isSourceTag, type BatchInput, type RuleInput, type SourceTag, type Who } from "./types";

/**
 * What a form (or a forged post) sends for a batch plan or a standing rule, checked HERE before anything goes to the API (the API checks again): closed words only, bounded text, bounded numbers. Pure.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : null);
/** A text with no markup or control characters, within bounds. */
const plain = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= min && t.length <= max && !/[<>{}\u0000-\u001f\u007f]/.test(t) ? t : null;
};
const cap = (v: unknown): number | null | undefined => (v === null || v === undefined || v === "" ? null : typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 1_000_000 ? v : undefined);
const questionsOf = (v: unknown): string[] | null => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 8) return null;
  const out: string[] = [];
  for (const q of v) {
    const t = plain(q, 3, 300);
    if (t === null) return null;
    out.push(t);
  }
  return out;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function whoOf(v: unknown): Who | null {
  if (!isObj(v)) return null;
  const ids = (x: unknown): string[] | null => (Array.isArray(x) && x.length >= 1 && x.length <= 500 && x.every((i) => typeof i === "string" && UUID.test(i)) ? (x as string[]) : null);
  if (v.kind === "contacts") {
    const i = ids(v.ids);
    return i ? { kind: "contacts", ids: i } : null;
  }
  if (v.kind === "leads") {
    const i = ids(v.ids);
    return i ? { kind: "leads", ids: i } : null;
  }
  if (v.kind === "source") {
    if (!isSourceTag(v.source)) return null;
    const status = v.status === null || v.status === undefined ? null : oneOf(v.status, ["new", "contacted", "qualified", "disqualified"] as const);
    if (v.status !== null && v.status !== undefined && status === null) return null;
    const since = v.since === null || v.since === undefined || v.since === "" ? null : typeof v.since === "string" && DAY.test(v.since) ? v.since : undefined;
    return since === undefined ? null : { kind: "source", source: v.source as SourceTag, status, since };
  }
  return null;
}

export function parseBatchInput(value: unknown): BatchInput | null {
  if (!isObj(value)) return null;
  const batchId = typeof value.batchId === "string" && UUID.test(value.batchId) ? value.batchId : null;
  const name = plain(value.name, 1, 200);
  const goal = oneOf(value.goal, GOALS);
  const channel = oneOf(value.channel, CHANNELS);
  const language = oneOf(value.language, CALL_LANGS);
  const who = whoOf(value.who);
  const questions = questionsOf(value.questions);
  const messageText = value.messageText === null || value.messageText === undefined || value.messageText === "" ? null : plain(value.messageText, 3, 600);
  const windowDays = typeof value.windowDays === "number" && Number.isInteger(value.windowDays) && value.windowDays >= 1 && value.windowDays <= 14 ? value.windowDays : null;
  const maxCallsPerDay = cap(value.maxCallsPerDay);
  const maxTotalMinutes = cap(value.maxTotalMinutes);
  if (!batchId || !name || !goal || !channel || !language || !who || !questions || windowDays === null || maxCallsPerDay === undefined || maxTotalMinutes === undefined) return null;
  if (value.messageText && messageText === null) return null;
  if ((channel === "whatsapp" || channel === "both") && messageText === null) return null; // a WhatsApp step needs its own words
  return { batchId, name, goal, channel, language, who, questions, messageText, windowDays, maxCallsPerDay, maxTotalMinutes };
}

export function parseRuleInput(value: unknown): RuleInput | null {
  if (!isObj(value)) return null;
  const ruleId = typeof value.ruleId === "string" && UUID.test(value.ruleId) ? value.ruleId : null;
  const source = typeof value.source === "string" && (RULE_SOURCES as readonly string[]).includes(value.source) ? (value.source as SourceTag) : null;
  const action = oneOf(value.action, RULE_ACTIONS);
  const withinMinutes = typeof value.withinMinutes === "number" && Number.isInteger(value.withinMinutes) && value.withinMinutes >= 1 && value.withinMinutes <= 120 ? value.withinMinutes : null;
  const goal = oneOf(value.goal, GOALS);
  const channel = oneOf(value.channel, CHANNELS);
  const language = oneOf(value.language, CALL_LANGS);
  const questions = questionsOf(value.questions);
  const messageText = value.messageText === null || value.messageText === undefined || value.messageText === "" ? null : plain(value.messageText, 3, 600);
  const maxCallsPerDay = cap(value.maxCallsPerDay);
  const maxTotalMinutes = cap(value.maxTotalMinutes);
  if (!ruleId || !source || !action || withinMinutes === null || !goal || !channel || !language || !questions || maxCallsPerDay === undefined || maxTotalMinutes === undefined) return null;
  if (value.messageText && messageText === null) return null;
  // a rule that sends a WhatsApp message first needs its words; a rule that only calls does not
  if ((action !== "call_within_minutes" || channel !== "call") && messageText === null) return null;
  return { ruleId, source, action, withinMinutes, goal, channel, language, questions, messageText, maxCallsPerDay, maxTotalMinutes };
}
