import type { SchedulerSettings, SchedulerStatus } from "./scheduler";

/** Invented answers in the shape of the scheduler contract (job AW). The clock of the examples: Wednesday 14 October 2026, 10:00 in India (04:30Z). */
export const STATUS_JSON = {
  platform_switch_on: true,
  auto_send_enabled: true,
  active: true,
  worker_running: true,
  last_run_at: "2026-10-14T04:28:00Z",
  next_run_at: "2026-10-14T04:29:00Z",
  interval_seconds: 60,
  last_activity_at: "2026-10-14T03:30:00Z",
  today: { sent: 2, failed: 0, reminders: 1, no_shows: 0, errors: 0 },
};
export const SETTINGS_JSON = { reminder_evening_enabled: true, reminder_evening_hour: 18, reminder_heads_up_enabled: true, reminder_heads_up_minutes: 120, no_show_enabled: false, no_show_after_minutes: 30, is_default: true };
export const status = (over: Partial<SchedulerStatus> = {}): SchedulerStatus => ({ ...(STATUS_JSON as SchedulerStatus), ...over });
export const schedulerSettings = (over: Partial<SchedulerSettings> = {}): SchedulerSettings => ({ ...(SETTINGS_JSON as SchedulerSettings), ...over });
