import { ApiContractError, ApiRequestError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * My AI team v2 (C1's docs/contracts/ai-team.md, 6 Nov 2026), with the signed-in person's own token. Base `/v1/tenants/{t}`:
 *
 *   GET  /ai-team/day?date=YYYY-MM-DD      Owner, Admin, Sales -> the day: a lane per helper with its marks (real rows), its status now, the flow strip, the day's cost
 *   GET  /ai-team/{helper}                 Owner, Admin, Sales -> the side panel (last 10 actions, today's numbers, cost, settings links, the switch)
 *   PUT  /ai-team/{helper}/switch          Owner, Admin with the second factor {enabled} -> {helper, enabled}; 403 mfa_required
 *   GET  /ai-team/standup?date=&language=  Owner, Admin -> the day's stand-up, or 404 not_generated
 *   POST /ai-team/standup {date?, language} Owner, Admin -> makes it (at most 3 a day: 429 standup_limit)
 *   GET  /ai-team/standup/audio?date=&language=  Owner, Admin -> audio/wav
 *
 * Every parser is strict: a field outside the contract is a contract error, never a guess on screen. A mark opens by its `ref.type` and `ref.id` (markHref), never by an address the API wrote.
 */
export const HELPERS = ["lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk", "admissions", "fee_reminders", "notices"] as const;
export type Helper = (typeof HELPERS)[number];
export const MARK_KINDS = ["lead_in", "search", "found", "call", "message", "followup_due", "quote", "quote_approved", "order", "visit", "admission", "fee_reminder", "payment", "notice"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const REF_TYPES = ["call", "lead", "quote", "order", "visit", "prospect", "student", "admission", "campaign", "intake"] as const;
export type RefType = (typeof REF_TYPES)[number];
export const STATUS_KINDS = ["paused", "busy", "due", "waiting", "idle"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];
const TEXT_KEYS = ["paused", "on_call", "due_next", "waiting_for_you", "idle"] as const;
export const FLOW_KEYS = ["leads_in", "called", "interested", "quotes", "orders", "enquiries", "campus_visits", "admissions", "fees_collected"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
export const STANDUP_LANGS = ["en", "te", "hi", "kn"] as const;

export type StatusNow = { kind: StatusKind; textKey: (typeof TEXT_KEYS)[number]; count: number | null; at: string | null; who: string | null; since: string | null };
export type Mark = { id: string; t: string; kind: MarkKind; seconds: number | null; label: string; ref: { type: RefType; id: string }; needsOwner: boolean };
export type Lane = { helper: Helper; enabled: boolean; statusNow: StatusNow | null; countToday: number; marks: Mark[] };
export type FlowStep = { key: FlowKey; count: number };
export type CostToday = { paise: number | null; callsMinutes: number | null; messages: number | null; aiPercent: number | null };
export type AiTeamDay = { date: string; now: string; day: { opens: string; closes: string; source: "default" | "business_hours" }; lanes: Lane[]; flow: { steps: FlowStep[]; extra: FlowStep[] }; costToday: CostToday | null; needsOwnerTotal: number };
export type PanelNumber = { key: string; value: number | null; bySource: { source: string; count: number }[] | null };
export type AiTeamPanel = {
  helper: Helper;
  statusNow: StatusNow | null;
  enabled: boolean;
  canSwitch: boolean;
  reasonLocked: "owner_or_admin" | null;
  recent: Mark[];
  today: { count: number; numbers: PanelNumber[] };
  costToday: { paise: number | null } | null;
  settings: { key: string; value: string | null; href: string }[];
};
export type StandupLine = { text: string; source: string };
export type Standup = {
  date: string;
  language: string;
  generatedAt: string;
  by: "schedule" | "owner";
  text: string;
  lines: StandupLine[];
  numbers: { key: string; value: number }[];
  audio: { seconds: number } | null;
  audioReason: "voice_off" | "limit" | "unavailable" | null;
  leftToday: number;
  draft: boolean;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected AI team ${what}.`);
};
const count = (v: unknown, what: string): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad(what));
const countOrNull = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : count(v, what));
const text = (v: unknown, what: string, max = 200): string => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : bad(what));
const textOrNull = (v: unknown, what: string, max = 200): string | null => (v === null || v === undefined ? null : text(v, what, max));
const time = (v: unknown, what: string): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : bad(what));
const timeOrNull = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : time(v, what));
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => ((list as readonly unknown[]).includes(v) ? (v as T) : bad(what));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseStatus(v: unknown): StatusNow | null {
  if (v === null || v === undefined) return null;
  if (!isRec(v)) return bad("status");
  return { kind: oneOf(v.kind, STATUS_KINDS, "status kind"), textKey: oneOf(v.text_key, TEXT_KEYS, "status words"), count: countOrNull(v.count, "status count"), at: timeOrNull(v.at, "status time"), who: textOrNull(v.who, "status name", 80), since: timeOrNull(v.since, "status since") };
}

export function parseMark(v: unknown): Mark {
  if (!isRec(v) || !isRec(v.ref)) return bad("mark");
  const id = text(v.ref.id, "mark ref");
  if (!isCanonicalUuid(id)) bad("mark ref id");
  return {
    id: text(v.id, "mark id", 120),
    t: time(v.t, "mark time"),
    kind: oneOf(v.kind, MARK_KINDS, "mark kind"),
    seconds: countOrNull(v.seconds, "mark seconds"),
    label: text(v.label, "mark label", 160),
    ref: { type: oneOf(v.ref.type, REF_TYPES, "mark ref type"), id },
    needsOwner: v.needs_owner === true,
  };
}

const flowStep = (v: unknown): FlowStep => (isRec(v) ? { key: oneOf(v.key, FLOW_KEYS, "flow step"), count: count(v.count, "flow count") } : bad("flow step"));

export function parseDay(json: unknown): AiTeamDay {
  if (!isRec(json) || !isRec(json.day) || !Array.isArray(json.lanes) || !isRec(json.flow) || !Array.isArray(json.flow.steps)) return bad("day");
  const date = typeof json.date === "string" && DATE.test(json.date) ? json.date : bad("date");
  const opens = typeof json.day.opens === "string" && HHMM.test(json.day.opens) ? json.day.opens : bad("opening time");
  const closes = typeof json.day.closes === "string" && HHMM.test(json.day.closes) ? json.day.closes : bad("closing time");
  const seen = new Set<string>();
  const lanes: Lane[] = json.lanes.slice(0, HELPERS.length).map((l) => {
    if (!isRec(l) || !Array.isArray(l.marks)) return bad("lane");
    const helper = oneOf(l.helper, HELPERS, "helper");
    if (seen.has(helper)) bad("lane twice");
    seen.add(helper);
    return { helper, enabled: l.enabled !== false, statusNow: parseStatus(l.status_now), countToday: count(l.count_today, "lane count"), marks: l.marks.slice(0, 200).map(parseMark) };
  });
  const c = json.cost_today;
  const cost: CostToday | null = isRec(c) ? { paise: countOrNull(c.paise, "cost"), callsMinutes: countOrNull(c.calls_minutes, "minutes"), messages: countOrNull(c.messages, "messages"), aiPercent: countOrNull(c.ai_percent, "AI share") } : c === null || c === undefined ? null : bad("cost");
  return {
    date,
    now: time(json.now, "now"),
    day: { opens, closes, source: json.day.source === "business_hours" ? "business_hours" : "default" },
    lanes,
    flow: { steps: json.flow.steps.map(flowStep), extra: Array.isArray(json.flow.extra) ? json.flow.extra.map(flowStep) : [] },
    costToday: cost,
    needsOwnerTotal: count(json.needs_owner_total ?? 0, "needs-you count"),
  };
}

export function parsePanel(json: unknown): AiTeamPanel {
  if (!isRec(json) || !Array.isArray(json.recent) || !isRec(json.today) || !Array.isArray(json.today.numbers)) return bad("panel");
  const numbers: PanelNumber[] = json.today.numbers.map((n) => {
    if (!isRec(n)) return bad("number");
    const key = text(n.key, "number key", 40);
    if (Array.isArray(n.value)) return { key, value: null, bySource: n.value.slice(0, 12).map((s) => (isRec(s) ? { source: text(s.source, "source", 40), count: count(s.count, "source count") } : bad("source"))) };
    return { key, value: countOrNull(n.value, "number"), bySource: null };
  });
  const settings = Array.isArray(json.settings)
    ? json.settings.slice(0, 10).map((s) => (isRec(s) ? { key: text(s.key, "setting", 40), value: textOrNull(s.value, "setting value", 120), href: text(s.href, "setting link", 200) } : bad("setting")))
    : [];
  return {
    helper: oneOf(json.helper, HELPERS, "helper"),
    statusNow: parseStatus(json.status_now),
    enabled: json.enabled !== false,
    canSwitch: json.can_switch === true,
    reasonLocked: json.reason_locked === "owner_or_admin" ? "owner_or_admin" : null,
    recent: json.recent.slice(0, 10).map(parseMark),
    today: { count: count(json.today.count, "panel count"), numbers },
    costToday: isRec(json.cost_today) ? { paise: countOrNull(json.cost_today.paise, "panel cost") } : null,
    settings,
  };
}

export function parseStandup(json: unknown): Standup {
  if (!isRec(json) || !Array.isArray(json.lines)) return bad("stand-up");
  const audio = isRec(json.audio) ? { seconds: count(json.audio.seconds, "audio length") } : null;
  return {
    date: typeof json.date === "string" && DATE.test(json.date) ? json.date : bad("stand-up date"),
    language: text(json.language, "stand-up language", 8),
    generatedAt: time(json.generated_at, "stand-up time"),
    by: json.by === "owner" ? "owner" : "schedule",
    text: text(json.text, "stand-up text", 4000),
    lines: json.lines.slice(0, 30).map((l) => (isRec(l) ? { text: text(l.text, "stand-up line", 600), source: text(l.source, "stand-up source", 60) } : bad("stand-up line"))),
    numbers: Array.isArray(json.numbers) ? json.numbers.slice(0, 60).map((n) => (isRec(n) && typeof n.value === "number" && Number.isFinite(n.value) ? { key: text(n.key, "number key", 60), value: n.value } : bad("stand-up number"))) : [],
    audio,
    audioReason: json.audio_reason === "voice_off" || json.audio_reason === "limit" || json.audio_reason === "unavailable" ? json.audio_reason : null,
    leftToday: count(json.left_today ?? 0, "stand-ups left"),
    draft: json.draft === true,
  };
}

const T = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-team`;
};
const q = (params: Record<string, string | null | undefined>): string => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  return s ? `?${s}` : "";
};
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const langOf = (lang: string): string => ((STANDUP_LANGS as readonly string[]).includes(lang) ? lang : "en");

export async function getAiTeamDay(token: string, tenantId: string, date: string | null): Promise<AiTeamDay> {
  return parseDay(await apiRequest(`${T(tenantId)}/day${q({ date: date && isDate(date) ? date : null })}`, token));
}
export async function getAiTeamPanel(token: string, tenantId: string, helper: Helper): Promise<AiTeamPanel> {
  return parsePanel(await apiRequest(`${T(tenantId)}/${oneOf(helper, HELPERS, "helper")}`, token));
}
export async function putHelperSwitch(token: string, tenantId: string, helper: Helper, enabled: boolean): Promise<{ helper: Helper; enabled: boolean }> {
  const json = await apiRequest(`${T(tenantId)}/${oneOf(helper, HELPERS, "helper")}/switch`, token, { method: "PUT", body: JSON.stringify({ enabled }) });
  if (!isRec(json) || json.helper !== helper || typeof json.enabled !== "boolean") return bad("switch");
  return { helper, enabled: json.enabled };
}
/** The day's stand-up, or null when it is not made yet (404 not_generated). */
export async function getStandup(token: string, tenantId: string, date: string | null, lang: string): Promise<Standup | null> {
  try {
    return parseStandup(await apiRequest(`${T(tenantId)}/standup${q({ date: date && isDate(date) ? date : null, language: langOf(lang) })}`, token));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
export async function makeStandup(token: string, tenantId: string, date: string | null, lang: string): Promise<Standup> {
  return parseStandup(await apiRequest(`${T(tenantId)}/standup`, token, { method: "POST", body: JSON.stringify({ ...(date && isDate(date) ? { date } : {}), language: langOf(lang) }) }));
}
/** The stand-up's sound (a WAV of 30 to 45 seconds; at most 4 MB), for our own route to hand to the browser. */
export async function getStandupAudio(token: string, tenantId: string, date: string | null, lang: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const r = await apiBinaryRequest(`${T(tenantId)}/standup/audio${q({ date: date && isDate(date) ? date : null, language: langOf(lang) })}`, token, 4_000_000);
  return { bytes: r.bytes, contentType: r.contentType };
}

/** Where a mark opens, by its kind of row and its id (the app's own routes; C1's `ref.href` is only its guess). */
export function markHref(base: string, ref: { type: RefType; id: string }): string | null {
  if (!isCanonicalUuid(ref.id)) return null;
  switch (ref.type) {
    case "lead":
      return `${base}/leads/${ref.id}`;
    case "call":
      // no page of one call yet: the live calls page, which shows the day's calls
      return `${base}/office/live?call=${ref.id}`;
    case "quote":
      return `${base}/quotes/${ref.id}`;
    case "order":
      return `${base}/orders/${ref.id}`;
    case "visit":
      return `${base}/visits?visit=${ref.id}`;
    case "prospect":
      return `${base}/retailers?prospect=${ref.id}`;
    case "student":
      return `${base}/students/${ref.id}`;
    case "admission":
      return `${base}/admissions?admission=${ref.id}`;
    case "campaign":
      return `${base}/campaigns/${ref.id}`;
    case "intake":
      return `${base}/lead-desk?intake=${ref.id}`;
  }
}
