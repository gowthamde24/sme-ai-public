/**
 * Speed to lead as ONE rule per source (Track D, contract lead-sources-v2.md d): `GET/PUT /outreach/speed-to-lead` = a default rule and, per source, its own rule or `null` (follows the default). It is a view over the policy and the standing rules, so nothing is stored twice.
 * The calling hours and the per-day call limit are the existing settings and always apply on top of it.
 */
export const SPEED_SOURCES = ["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets"] as const;
export type SpeedSource = (typeof SPEED_SOURCES)[number];

export type SpeedRule = {
  enabled: boolean;
  /** In calling hours: call within this many minutes (1 to 120). */
  callWithinMinutes: number;
  /** Outside calling hours: a WhatsApp message now, and the call at this minute of the next day (600 to 720, steps of 15; 600 = 10:00; an older saved 540 to 599 is still read). */
  whatsappNow: boolean;
  callAtMinute: number;
  /** No answer: tries in all (1 to 6), the gap between them (1 to 48 hours), then a WhatsApp message. */
  maxAttempts: number;
  gapHours: number;
  thenWhatsapp: boolean;
  /** A hot lead goes to the owner (or one member) with a reminder after this many minutes. */
  hotLead: boolean;
  handoffTo: string;
  reminderMinutes: number;
};
export type SpeedRules = { default: SpeedRule; perSource: Partial<Record<SpeedSource, SpeedRule | null>> };

export const DEFAULT_SPEED_RULE: SpeedRule = { enabled: true, callWithinMinutes: 2, whatsappNow: true, callAtMinute: 600, maxAttempts: 3, gapHours: 4, thenWhatsapp: true, hotLead: true, handoffTo: "owner", reminderMinutes: 15 };

export const CALL_WITHIN = [1, 2, 5, 10, 15, 30, 60, 120] as const;
export const CALL_AT = [600, 630, 660, 690, 720] as const;
export const ATTEMPTS = [1, 2, 3, 4, 5, 6] as const;
export const GAPS = [1, 2, 4, 6, 12, 24, 48] as const;
export const REMINDERS = [5, 10, 15, 30, 60] as const;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** One rule from the API's shape; anything out of range or missing makes the whole rule unreadable (null), never a guess. */
export function parseSpeedRule(json: unknown): SpeedRule | null {
  if (!isRec(json) || !isRec(json.in_hours) || !isRec(json.after_hours) || !isRec(json.retries) || !isRec(json.handoff)) return null;
  const enabled = bool(json.enabled);
  const within = intIn(json.in_hours.call_within_minutes, 1, 120);
  const whatsappNow = bool(json.after_hours.whatsapp_now);
  const at = intIn(json.after_hours.call_at_minute, 540, 720);
  const attempts = intIn(json.retries.max_attempts, 1, 6);
  const gap = intIn(json.retries.gap_hours, 1, 48);
  const then = bool(json.retries.then_whatsapp);
  const hot = bool(json.handoff.hot_lead);
  const to = typeof json.handoff.to === "string" && /^[A-Za-z0-9-]{1,64}$/.test(json.handoff.to) ? json.handoff.to : null;
  const reminder = intIn(json.handoff.reminder_minutes, 1, 600);
  if (enabled === null || within === null || whatsappNow === null || at === null || attempts === null || gap === null || then === null || hot === null || to === null || reminder === null) return null;
  return { enabled, callWithinMinutes: within, whatsappNow, callAtMinute: at, maxAttempts: attempts, gapHours: gap, thenWhatsapp: then, hotLead: hot, handoffTo: to, reminderMinutes: reminder };
}

export function parseSpeedRules(json: unknown): SpeedRules | null {
  if (!isRec(json)) return null;
  const def = parseSpeedRule(json.default);
  if (!def) return null;
  const perSource: SpeedRules["perSource"] = {};
  const given = isRec(json.per_source) ? json.per_source : {};
  for (const kind of SPEED_SOURCES) {
    const raw = given[kind];
    perSource[kind] = raw === undefined || raw === null ? null : parseSpeedRule(raw); // an unreadable own rule follows the default rather than showing a wrong one
  }
  return { default: def, perSource };
}

export const speedRuleBody = (r: SpeedRule) => ({
  enabled: r.enabled,
  in_hours: { action: "call", call_within_minutes: r.callWithinMinutes },
  after_hours: { whatsapp_now: r.whatsappNow, call_at_minute: r.callAtMinute },
  retries: { max_attempts: r.maxAttempts, gap_hours: r.gapHours, then_whatsapp: r.thenWhatsapp },
  handoff: { hot_lead: r.hotLead, to: r.handoffTo, reminder_minutes: r.reminderMinutes },
});
export const speedRulesBody = (rules: SpeedRules) => ({
  default: speedRuleBody(rules.default),
  per_source: Object.fromEntries(SPEED_SOURCES.map((k) => [k, rules.perSource[k] ? speedRuleBody(rules.perSource[k] as SpeedRule) : null])),
});

/** The browser's input (the app's own camelCase shape), checked again on the server with the same ranges as the API's, so a bad value is refused before anything is sent. */
function inputRule(v: unknown): SpeedRule | null {
  if (!isRec(v)) return null;
  const enabled = bool(v.enabled), whatsappNow = bool(v.whatsappNow), thenWhatsapp = bool(v.thenWhatsapp), hotLead = bool(v.hotLead);
  const within = intIn(v.callWithinMinutes, 1, 120), at = intIn(v.callAtMinute, 600, 720), attempts = intIn(v.maxAttempts, 1, 6), gap = intIn(v.gapHours, 1, 48), reminder = intIn(v.reminderMinutes, 1, 600);
  const to = typeof v.handoffTo === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v.handoffTo) ? v.handoffTo : null;
  if (enabled === null || whatsappNow === null || thenWhatsapp === null || hotLead === null || within === null || at === null || at % 15 !== 0 || attempts === null || gap === null || reminder === null || to === null) return null;
  return { enabled, callWithinMinutes: within, whatsappNow, callAtMinute: at, maxAttempts: attempts, gapHours: gap, thenWhatsapp, hotLead, handoffTo: to, reminderMinutes: reminder };
}
export function parseSpeedInput(json: unknown): SpeedRules | null {
  if (!isRec(json)) return null;
  const def = inputRule(json.default);
  if (!def) return null;
  const given = isRec(json.perSource) ? json.perSource : {};
  const perSource: SpeedRules["perSource"] = {};
  for (const kind of SPEED_SOURCES) {
    const raw = given[kind];
    if (raw === undefined || raw === null) perSource[kind] = null;
    else {
      const r = inputRule(raw);
      if (!r) return null;
      perSource[kind] = r;
    }
  }
  return { default: def, perSource };
}
