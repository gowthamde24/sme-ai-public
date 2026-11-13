import type { TaskOut } from "@/lib/tasks/types";

/**
 * "Your assistant is working on" (design system v6): the job that was approved and is not finished, as steps with ticks, built from the task's own plan and progress (the existing tasks API; TASK_SCREENS). Pure: no fetch, no React. A part that cannot be read leaves its step out.
 */
export type StepState = "done" | "now" | "later";
export type WorkingStep = { id: "picked" | "called" | "calling" | "report"; state: StepState; n: number; extra: number; hoursTo: string | null };
export type Working = { id: string; title: string; status: "approved" | "running" | "paused"; approvedAt: string | null; steps: WorkingStep[] };

const ACTIVE: readonly string[] = ["approved", "running", "paused"];
export const isActive = (t: TaskOut): boolean => ACTIVE.includes(t.status);

/** "8 pm" from a minute of the day (1200 = 8 pm), in 12-hour words, English digits (the screen's words come from the string store). */
export function hourText(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** The newest active task as the card shows it; null when none is going on. `title` is the owner's own instruction, shortened. */
export function workingFrom(tasks: readonly TaskOut[]): Working | null {
  const task = [...tasks].filter(isActive).sort((a, b) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at))[0];
  if (!task) return null;
  const p = task.progress;
  const total = task.plan?.contacts_total ?? p.total;
  const rest = p.waiting + p.in_progress;
  const hoursTo = task.plan?.window ? hourText(task.plan.window.to_minute) : null;
  const steps: WorkingStep[] = [
    { id: "picked", state: "done", n: total, extra: 0, hoursTo: null },
    { id: "called", state: p.done > 0 ? "done" : "later", n: p.done, extra: p.positive, hoursTo: null },
    { id: "calling", state: rest > 0 ? (p.done > 0 || task.status === "running" ? "now" : "later") : "done", n: rest, extra: 0, hoursTo },
    { id: "report", state: rest === 0 && total > 0 ? "now" : "later", n: 0, extra: 0, hoursTo: null },
  ];
  const text = task.instruction.trim();
  return { id: task.id, title: text.length <= 90 ? text : `${text.slice(0, 89).trimEnd()}…`, status: task.status as Working["status"], approvedAt: task.approved_at, steps };
}
