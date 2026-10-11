/**
 * What Agent OWL's checking looks like to a person, from `GET /scheduler/status` (job AW). The worker's heartbeat is for the whole installation, so "last checked" is always true to say. `off` says why Agent OWL's
 * automatic work does nothing for this business (the system-wide switch, or the business's own automatic sending), and then a late check is not a problem. Only when it SHOULD be working (`active`) and has not been
 * heard from for more than five minutes is the view `stale`: a calm warning, because messages held for 9:00 and visit reminders may then be late.
 */
export const STALE_AFTER_MINUTES = 5;
export type SchedulerView =
  | { state: "never"; off: "system" | "business" | null }
  | { state: "calm"; minutes: number; next: string | null; off: "system" | "business" | null }
  | { state: "stale"; minutes: number };

export function schedulerView(s: { platform_switch_on: boolean; auto_send_enabled: boolean; active: boolean; last_run_at: string | null; next_run_at: string | null }, now: number): SchedulerView {
  const off = !s.platform_switch_on ? "system" : !s.auto_send_enabled ? "business" : null;
  if (s.last_run_at === null) return { state: "never", off };
  const minutes = Math.max(0, Math.floor((now - Date.parse(s.last_run_at)) / 60_000));
  if (s.active && minutes > STALE_AFTER_MINUTES) return { state: "stale", minutes };
  return { state: "calm", minutes, next: s.next_run_at, off };
}
