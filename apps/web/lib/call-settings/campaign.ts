import { parseCallSettings, type CallSettings } from "./types";

/**
 * The call settings of ONE campaign (job DQ part 3; contract-call-settings.md, "Per campaign"): the workspace's settings with the fields the campaign changes laid over them. Every field except the holidays, the hand-over people and
 * what it may call about can be changed for a campaign; a list REPLACES the workspace's list; to switch the automatic pause off for one campaign the body says `auto_pause_off: true` (null in `auto_pause_refusals_per_hour` means "follow
 * the workspace"). Pure: no request, no cookie. The screen edits the whole effective settings and sends only what differs from the workspace's (`diffOverride`), so what it does not touch keeps following the workspace.
 */
export const OVERRIDABLE = [
  "retry_busy", "retry_no_answer", "retry_call_later", "concurrent_calls", "detect_voicemail", "voicemail_action", "detect_phone_menu", "phone_menu_action", "silence_timeout_seconds", "max_call_seconds", "interruption_sensitivity",
  "listening_sounds", "pronunciations", "keywords", "hours", "max_calls_per_customer_per_week", "auto_pause_refusals_per_hour", "contact_memory",
] as const;
export type OverridableField = (typeof OVERRIDABLE)[number];
/** What a campaign changes: only the fields it changes (absent = follows the workspace), and `auto_pause_off` for "never pause by itself, here". */
export type CampaignOverride = Partial<Pick<CallSettings, OverridableField>> & { auto_pause_off?: true };

/** The group of the screen a field is in (the badge "Different here" sits on the group's heading). */
export const FIELD_GROUP: Record<OverridableField, "retry" | "line" | "words" | "when" | "safety" | "memory"> = {
  retry_busy: "retry", retry_no_answer: "retry", retry_call_later: "retry", concurrent_calls: "retry",
  detect_voicemail: "line", voicemail_action: "line", detect_phone_menu: "line", phone_menu_action: "line", silence_timeout_seconds: "line", max_call_seconds: "line", interruption_sensitivity: "line", listening_sounds: "line",
  pronunciations: "words", keywords: "words",
  hours: "when", max_calls_per_customer_per_week: "when",
  auto_pause_refusals_per_hour: "safety",
  contact_memory: "memory",
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What `edited` changes against the workspace's `base`: nothing the campaign leaves as it is. "Follow the assistant's hours" (`hours: null`) cannot be said as a campaign override (null means "follow"), so it is not one. */
export function diffOverride(base: CallSettings, edited: CallSettings): CampaignOverride {
  const out: Record<string, unknown> = {};
  for (const k of OVERRIDABLE) {
    if (same(base[k], edited[k])) continue;
    if (k === "auto_pause_refusals_per_hour") {
      if (edited[k] === null) out.auto_pause_off = true;
      else out[k] = edited[k];
    } else if (k === "hours") {
      if (edited.hours !== null) out.hours = edited.hours;
    } else out[k] = edited[k];
  }
  return out as CampaignOverride;
}

/** The workspace's settings with a campaign's override laid over them. */
export function applyOverride(base: CallSettings, o: CampaignOverride): CallSettings {
  const out: CallSettings = { ...base };
  for (const k of OVERRIDABLE) if (o[k] !== undefined && o[k] !== null) (out as Record<string, unknown>)[k] = o[k];
  if (o.auto_pause_off === true) out.auto_pause_refusals_per_hour = null;
  return out;
}

/** The fields an override changes against `base` (what the screen marks "Different here"): by value, so an override equal to the workspace's is not marked. */
export function overriddenFields(base: CallSettings, effective: CallSettings): OverridableField[] {
  return OVERRIDABLE.filter((k) => !same(base[k], effective[k]));
}

/** A campaign override as a form or a cookie gave it: only known fields, and the whole thing laid over `base` must be valid call settings (so every range is the range of the workspace's settings). Null when any part is not. */
export function parseOverride(value: unknown, base: CallSettings): CampaignOverride | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowed = new Set<string>([...OVERRIDABLE, "auto_pause_off"]);
  if (Object.keys(raw).some((k) => !allowed.has(k))) return null;
  if (raw.auto_pause_off !== undefined && raw.auto_pause_off !== true) return null;
  const picked: Record<string, unknown> = {};
  for (const k of OVERRIDABLE) if (raw[k] !== undefined && raw[k] !== null) picked[k] = raw[k];
  if (raw.auto_pause_off === true) picked.auto_pause_off = true;
  const merged = parseCallSettings(applyOverride(base, picked as CampaignOverride));
  if (merged === null) return null;
  // what is kept is the checked form of each field (trimmed words, sorted days), only for the fields the person sent
  const out: Record<string, unknown> = {};
  for (const k of OVERRIDABLE) if (picked[k] !== undefined) out[k] = merged[k];
  if (picked.auto_pause_off === true) out.auto_pause_off = true;
  return out as CampaignOverride;
}
