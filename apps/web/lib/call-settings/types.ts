/**
 * How the AI assistant behaves ON THE PHONE, as data (job DP; C1's contract-call-settings.md): retries, parallel calls, voicemail and phone menus, silence, the longest call, interruption, listening sounds, pronunciations,
 * key words, calling hours and holidays, how often one customer may be called, when to pause by itself, who takes over for which topic, memory, and what it may phone about. One setting per workspace. The API's own shape (snake_case)
 * is the one the screen edits, so there is no mapping to get wrong. Every value is checked (`parseCallSettings`): an answer, a form or a cookie that is not in these ranges is ignored, never drawn. A school makes no sales calls
 * and none about dues or fees (the API and the database refuse them: `locked.allowed_purposes`). The names and numbers of hand-over people are personal data: only Owner and Admin ever read them.
 */
export const ACTIONS = ["hang_up", "leave_message", "retry_later"] as const;
export const MENU_ACTIONS = ["hang_up", "retry_later"] as const;
export const SENSITIVITY = ["low", "medium", "high"] as const;
export const TOPICS = ["pricing", "payment", "delivery", "complaint", "visit", "other"] as const;
export const PURPOSES = ["sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder"] as const;
export type Purpose = (typeof PURPOSES)[number];
export type Topic = (typeof TOPICS)[number];

export type Retry = { count: number; gap_minutes: number };
export type CallSettings = {
  retry_busy: Retry;
  retry_no_answer: Retry;
  retry_call_later: Retry;
  concurrent_calls: number;
  detect_voicemail: boolean;
  voicemail_action: (typeof ACTIONS)[number];
  detect_phone_menu: boolean;
  phone_menu_action: (typeof MENU_ACTIONS)[number];
  silence_timeout_seconds: number;
  max_call_seconds: number;
  interruption_sensitivity: (typeof SENSITIVITY)[number];
  listening_sounds: boolean;
  pronunciations: { written: string; spoken: string }[];
  keywords: string[];
  /** null = follow the AI assistant's calling hours (Settings > AI assistant). Minutes after midnight, 09:00 (540) to 21:00 (1260), steps of 15; days 1 (Monday) to 7. */
  hours: { days: number[]; from_minute: number; to_minute: number } | null;
  holidays: string[];
  max_calls_per_customer_per_week: number;
  /** null = never pause by itself. */
  auto_pause_refusals_per_hour: number | null;
  contact_memory: boolean;
  handover: { topic: Topic; person_name: string; phone: string }[];
  allowed_purposes: Purpose[];
};
export type CallSettingsRead = { settings: CallSettings; /** Whether the Owner has saved their own (else these are the business type's defaults). */ saved: boolean; /** The only purposes this business type may switch on (a school's), or null = all. */ lockedPurposes: readonly Purpose[] | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number, step = 1): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max && (v - min) % step === 0;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
/** Strings that are spoken or listened for carry no `< > { } @ / \ |` and no control characters. */
export const spokenOk = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.trim().length <= max && !/[<>{}@/\\|\u0000-\u001f\u007f]/.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?\d{7,15}$/; // the API's own pattern: an optional +, then 7 to 15 digits

function retry(v: unknown): Retry | null {
  return isRecord(v) && int(v.count, 0, 5) && int(v.gap_minutes, 5, 1440, 5) ? { count: v.count, gap_minutes: v.gap_minutes } : null;
}

/** `value` as call settings, or null when ANY part of it is outside its range. (A value is never half-accepted.) */
export function parseCallSettings(value: unknown): CallSettings | null {
  if (!isRecord(value)) return null;
  const v = value;
  const busy = retry(v.retry_busy), none = retry(v.retry_no_answer), later = retry(v.retry_call_later);
  if (!busy || !none || !later) return null;
  if (!int(v.concurrent_calls, 1, 20) || typeof v.detect_voicemail !== "boolean" || !oneOf(ACTIONS, v.voicemail_action) || typeof v.detect_phone_menu !== "boolean" || !oneOf(MENU_ACTIONS, v.phone_menu_action)) return null;
  if (!int(v.silence_timeout_seconds, 3, 30) || !int(v.max_call_seconds, 30, 1800, 30) || !oneOf(SENSITIVITY, v.interruption_sensitivity) || typeof v.listening_sounds !== "boolean") return null;
  if (!Array.isArray(v.pronunciations) || v.pronunciations.length > 50 || !v.pronunciations.every((p) => isRecord(p) && spokenOk(p.written, 1, 60) && spokenOk(p.spoken, 1, 60))) return null;
  if (new Set(v.pronunciations.map((p: { written: string }) => p.written.trim().toLowerCase())).size !== v.pronunciations.length) return null; // a name once
  if (!Array.isArray(v.keywords) || v.keywords.length > 100 || !v.keywords.every((k) => spokenOk(k, 2, 40))) return null;
  let hours: CallSettings["hours"] = null;
  if (v.hours !== null) {
    const h = v.hours;
    if (!isRecord(h) || !Array.isArray(h.days) || h.days.length === 0 || h.days.length > 7 || !h.days.every((d) => int(d, 1, 7)) || new Set(h.days).size !== h.days.length || !int(h.from_minute, 540, 1260, 15) || !int(h.to_minute, 540, 1260, 15) || h.from_minute >= h.to_minute) return null;
    hours = { days: [...(h.days as number[])].sort((a, b) => a - b), from_minute: h.from_minute, to_minute: h.to_minute };
  }
  if (!Array.isArray(v.holidays) || v.holidays.length > 60 || !v.holidays.every((d) => typeof d === "string" && DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) return null;
  if (!int(v.max_calls_per_customer_per_week, 1, 14) || !(v.auto_pause_refusals_per_hour === null || int(v.auto_pause_refusals_per_hour, 3, 100)) || typeof v.contact_memory !== "boolean") return null;
  if (!Array.isArray(v.handover) || v.handover.length > 8 || !v.handover.every((h) => isRecord(h) && oneOf(TOPICS, h.topic) && spokenOk(h.person_name, 1, 60) && typeof h.phone === "string" && PHONE.test(h.phone))) return null;
  if (new Set(v.handover.map((h: { topic: string }) => h.topic)).size !== v.handover.length) return null; // a topic goes to one person
  if (!Array.isArray(v.allowed_purposes) || v.allowed_purposes.length > PURPOSES.length || !v.allowed_purposes.every((p) => oneOf(PURPOSES, p)) || new Set(v.allowed_purposes).size !== v.allowed_purposes.length) return null;
  return {
    retry_busy: busy,
    retry_no_answer: none,
    retry_call_later: later,
    concurrent_calls: v.concurrent_calls,
    detect_voicemail: v.detect_voicemail,
    voicemail_action: v.voicemail_action,
    detect_phone_menu: v.detect_phone_menu,
    phone_menu_action: v.phone_menu_action,
    silence_timeout_seconds: v.silence_timeout_seconds,
    max_call_seconds: v.max_call_seconds,
    interruption_sensitivity: v.interruption_sensitivity,
    listening_sounds: v.listening_sounds,
    pronunciations: (v.pronunciations as { written: string; spoken: string }[]).map((p) => ({ written: p.written.trim(), spoken: p.spoken.trim() })),
    keywords: (v.keywords as string[]).map((k) => k.trim()),
    hours,
    holidays: [...(v.holidays as string[])].sort(),
    max_calls_per_customer_per_week: v.max_calls_per_customer_per_week,
    auto_pause_refusals_per_hour: v.auto_pause_refusals_per_hour,
    contact_memory: v.contact_memory,
    handover: (v.handover as CallSettings["handover"]).map((h) => ({ topic: h.topic, person_name: h.person_name.trim(), phone: h.phone })),
    allowed_purposes: PURPOSES.filter((p) => (v.allowed_purposes as string[]).includes(p)),
  };
}

/** What a business type may switch on: a school (module `programmes`) has no sales call and none about payment. Pure; applied on every read and every save. */
export function purposesFor(modules: readonly string[] | null | undefined): readonly Purpose[] | null {
  return modules?.includes("programmes") ? ["admission_followup", "visit_reminder", "event_reminder"] : null;
}
export function enforceSchool(s: CallSettings, locked: readonly Purpose[] | null): CallSettings {
  return locked === null ? s : { ...s, allowed_purposes: s.allowed_purposes.filter((p) => locked.includes(p)) };
}

/** The defaults (the shop's; a school's differ in purposes and memory). The API owns the real ones; these stand in for the test screens only. */
export function defaultCallSettings(modules: readonly string[] | null | undefined): CallSettings {
  const locked = purposesFor(modules);
  return {
    retry_busy: { count: 2, gap_minutes: 30 },
    retry_no_answer: { count: 3, gap_minutes: 120 },
    retry_call_later: { count: 2, gap_minutes: 60 },
    concurrent_calls: 1,
    detect_voicemail: true,
    voicemail_action: "retry_later",
    detect_phone_menu: true,
    phone_menu_action: "hang_up",
    silence_timeout_seconds: 8,
    max_call_seconds: 300,
    interruption_sensitivity: "medium",
    listening_sounds: true,
    pronunciations: [],
    keywords: [],
    hours: null,
    holidays: [],
    max_calls_per_customer_per_week: 2,
    auto_pause_refusals_per_hour: 10,
    contact_memory: locked === null,
    handover: [],
    allowed_purposes: locked === null ? ["sales_followup", "payment_reminder", "visit_reminder"] : ["admission_followup", "visit_reminder"],
  };
}
