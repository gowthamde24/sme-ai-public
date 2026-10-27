import type { ListedPerson, ReportOut, TaskError, TaskLang, TaskOut } from "@/lib/tasks/types";

/** The moves a task screen can make, as the page or the layout hands them over (the server actions of tasks-actions.ts with the workspace already bound). The result types are those of that file. */
export type TaskActionError = TaskError;
export type TaskActionResult = { ok: true; task: TaskOut } | { ok: false; error: TaskActionError };
export type ReportActionResult = { ok: true; report: ReportOut } | { ok: false; error: TaskActionError };
export type TemplateChoice = { id: string; label: string; example: string; promotional: boolean };
export type TemplatesActionResult = { ok: true; templates: TemplateChoice[] } | { ok: false; error: TaskActionError };
export type TaskActions = {
  plan: (taskId: string, instruction: string, language: TaskLang | null, contacts?: ListedPerson[]) => Promise<TaskActionResult>;
  answer: (taskId: string, answer: string) => Promise<TaskActionResult>;
  exclude: (taskId: string, contactIds: string[], excluded: boolean) => Promise<TaskActionResult>;
  approve: (taskId: string, planSha256: string, capPaise?: number | null) => Promise<TaskActionResult>;
  setCap: (taskId: string, capPaise: number) => Promise<TaskActionResult>;
  run: (taskId: string) => Promise<TaskActionResult>;
  pause: (taskId: string) => Promise<TaskActionResult>;
  resume: (taskId: string) => Promise<TaskActionResult>;
  cancel: (taskId: string) => Promise<TaskActionResult>;
  progress: (taskId: string) => Promise<TaskActionResult>;
  report: (taskId: string) => Promise<ReportActionResult>;
  templates: () => Promise<TemplatesActionResult>;
};

/** What the signed-in person may do on a task screen (decided on the server from the role; the API is the real gate). */
export type TaskPowers = { plan: boolean; approve: boolean; move: boolean };
export const powersOf = (role: string): TaskPowers => ({ plan: role === "owner" || role === "admin" || role === "sales", approve: role === "owner", move: role === "owner" || role === "admin" });
