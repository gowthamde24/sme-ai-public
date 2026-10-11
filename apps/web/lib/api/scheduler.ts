import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Agent OWL's scheduler (job AW, ADR 0068): the worker that releases messages held for quiet hours, makes visit reminders and marks no-shows. Server side only, with the signed-in user's own token. Counts and times
 * only: no phone number, message text or name is anywhere in these answers. `GET /scheduler/status` and `GET /scheduler/settings`: Owner and Admin; `PUT /scheduler/settings`: the Owner, with the second factor.
 * A response that does not match the contract is an error and nothing is shown.
 */
export interface SchedulerStatus {
  /** The system-wide sending switch (the operator's). */
  platform_switch_on: boolean;
  /** This business's automatic sending. */
  auto_send_enabled: boolean;
  /** Both switches on: the worker acts for this business. */
  active: boolean;
  /** Heard from within three of its own intervals. */
  worker_running: boolean;
  /** null = the worker was never heard from. */
  last_run_at: string | null;
  /** null = never heard from, or it stopped. */
  next_run_at: string | null;
  interval_seconds: number | null;
  last_activity_at: string | null;
  today: { sent: number; failed: number; reminders: number; no_shows: number; errors: number };
}

export interface SchedulerSettings {
  reminder_evening_enabled: boolean;
  /** 9 to 20 (the evening before, from this hour until 21:00). */
  reminder_evening_hour: number;
  reminder_heads_up_enabled: boolean;
  /** 60 to 480 minutes before the visit. */
  reminder_heads_up_minutes: number;
  no_show_enabled: boolean;
  /** 5 to 720 minutes after the slot ended. */
  no_show_after_minutes: number;
  /** true until the Owner saves their own. */
  is_default: boolean;
}

export const EVENING_HOURS = { min: 9, max: 20 } as const;
export const HEADS_UP_MINUTES = { min: 60, max: 480 } as const;
export const NO_SHOW_MINUTES = { min: 5, max: 720 } as const;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a scheduler response.`);
}
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const count = (v: unknown, what: string): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad(what));
const ranged = (v: unknown, what: string, r: { min: number; max: number }): number => (typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max ? v : bad(what));
function when(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}
const nullableWhen = (v: unknown, what: string): string | null => (v === null ? null : when(v, what));

export function parseSchedulerStatus(json: unknown): SchedulerStatus {
  if (!isRecord(json) || !isRecord(json.today)) return bad("status");
  const t = json.today;
  const interval = json.interval_seconds;
  return {
    platform_switch_on: bool(json.platform_switch_on, "platform_switch_on"),
    auto_send_enabled: bool(json.auto_send_enabled, "auto_send_enabled"),
    active: bool(json.active, "active"),
    worker_running: bool(json.worker_running, "worker_running"),
    last_run_at: nullableWhen(json.last_run_at, "last_run_at"),
    next_run_at: nullableWhen(json.next_run_at, "next_run_at"),
    interval_seconds: interval === null ? null : ranged(interval, "interval_seconds", { min: 1, max: 86_400 }),
    last_activity_at: nullableWhen(json.last_activity_at, "last_activity_at"),
    today: { sent: count(t.sent, "sent"), failed: count(t.failed, "failed"), reminders: count(t.reminders, "reminders"), no_shows: count(t.no_shows, "no_shows"), errors: count(t.errors, "errors") },
  };
}

export function parseSchedulerSettings(json: unknown): SchedulerSettings {
  if (!isRecord(json)) return bad("settings");
  return {
    reminder_evening_enabled: bool(json.reminder_evening_enabled, "reminder_evening_enabled"),
    reminder_evening_hour: ranged(json.reminder_evening_hour, "reminder_evening_hour", EVENING_HOURS),
    reminder_heads_up_enabled: bool(json.reminder_heads_up_enabled, "reminder_heads_up_enabled"),
    reminder_heads_up_minutes: ranged(json.reminder_heads_up_minutes, "reminder_heads_up_minutes", HEADS_UP_MINUTES),
    no_show_enabled: bool(json.no_show_enabled, "no_show_enabled"),
    no_show_after_minutes: ranged(json.no_show_after_minutes, "no_show_after_minutes", NO_SHOW_MINUTES),
    is_default: bool(json.is_default, "is_default"),
  };
}

const path = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/scheduler/${tail}`;
};

export async function getSchedulerStatus(accessToken: string, tenantId: string): Promise<SchedulerStatus> {
  return parseSchedulerStatus(await apiRequest(path(tenantId, "status"), accessToken));
}

export async function getSchedulerSettings(accessToken: string, tenantId: string): Promise<SchedulerSettings> {
  return parseSchedulerSettings(await apiRequest(path(tenantId, "settings"), accessToken));
}

/** `PUT /scheduler/settings`: the whole set at once. The Owner only, with the second factor. */
export async function putSchedulerSettings(accessToken: string, tenantId: string, s: Omit<SchedulerSettings, "is_default">): Promise<SchedulerSettings> {
  const body = {
    reminder_evening_enabled: s.reminder_evening_enabled,
    reminder_evening_hour: s.reminder_evening_hour,
    reminder_heads_up_enabled: s.reminder_heads_up_enabled,
    reminder_heads_up_minutes: s.reminder_heads_up_minutes,
    no_show_enabled: s.no_show_enabled,
    no_show_after_minutes: s.no_show_after_minutes,
  };
  return parseSchedulerSettings(await apiRequest(path(tenantId, "settings"), accessToken, { method: "PUT", body: JSON.stringify(body) }));
}
