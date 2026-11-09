/**
 * "Plan and usage in plain words" (app v4 part 8, owner 9 Nov 2026): "212 of 300 call minutes, about 9 days left at this pace". The pace is arithmetic on real numbers only: the minutes used so far this month (nav-counts) over the days that have
 * passed since the monthly window began (the API's own `resets_at_month`, minus one month). It says nothing until at least 3 days have passed and some minutes were used ("Not enough days yet to tell"); the days are rounded down; and
 * when the minutes would last past the end of the window it says so instead of a number. Nothing here is a plan price or a limit: it only reads.
 */
export type PaceWords = { kind: "days"; days: number } | { kind: "enough" } | { kind: "none" } | { kind: "too_early" };

export function pace(used: number, total: number, resetsAt: string, now: number): PaceWords {
  const end = Date.parse(resetsAt);
  if (!Number.isFinite(end) || total <= 0 || used < 0) return { kind: "too_early" };
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const elapsed = (now - start.getTime()) / 86_400_000;
  if (elapsed < 3 || used <= 0) return { kind: "too_early" };
  const left = total - used;
  if (left <= 0) return { kind: "none" };
  const days = Math.floor(left / (used / elapsed));
  const toReset = (end - now) / 86_400_000;
  return days >= toReset ? { kind: "enough" } : { kind: "days", days };
}
