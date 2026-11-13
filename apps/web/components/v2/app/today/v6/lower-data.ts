import type { TaskOut } from "@/lib/tasks/types";

/**
 * "Your assistant is working on" (design system v6, the final Today): the job that was approved and is not finished, with a progress bar and one line, built from the task's own plan and progress (the existing tasks API; TASK_SCREENS). Pure: no fetch, no React.
 */
export type Working = {
  id: string;
  title: string;
  status: "approved" | "running" | "paused";
  approvedAt: string | null;
  /** People picked, called so far, interested among them, and still to call. */
  total: number;
  done: number;
  positive: number;
  waiting: number;
  /** The end of the calling hours, as a minute of the day (1200 = 8 pm), or null. */
  toMinute: number | null;
};

const ACTIVE: readonly string[] = ["approved", "running", "paused"];
export const isActive = (t: TaskOut): boolean => ACTIVE.includes(t.status);

/** "8 pm" from a minute of the day (1200 = 8 pm), in 12-hour words, English digits (the screen's words come from the string store). */
export function hourText(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** The share of the job done, 0 to 100 (an empty job is 0). */
export const percentDone = (w: Pick<Working, "total" | "done">): number => (w.total > 0 ? Math.max(0, Math.min(100, Math.round((w.done / w.total) * 100))) : 0);

/** The newest active task as the card shows it; null when none is going on. `title` is the owner's own instruction, shortened. */
export function workingFrom(tasks: readonly TaskOut[]): Working | null {
  const task = [...tasks].filter(isActive).sort((a, b) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at))[0];
  if (!task) return null;
  const p = task.progress;
  const text = task.instruction.trim();
  return {
    id: task.id,
    title: text.length <= 90 ? text : `${text.slice(0, 89).trimEnd()}…`,
    status: task.status as Working["status"],
    approvedAt: task.approved_at,
    total: task.plan?.contacts_total ?? p.total,
    done: p.done,
    positive: p.positive,
    waiting: p.waiting + p.in_progress,
    toMinute: task.plan?.window ? task.plan.window.to_minute : null,
  };
}
