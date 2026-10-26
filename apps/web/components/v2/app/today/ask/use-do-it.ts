"use client";

import * as React from "react";

import type { ReportOut, TaskError, TaskOut } from "@/lib/tasks/types";

import type { TaskActions, TaskPowers, TemplateChoice } from "../../tasks/task-actions";
import type { AskWords } from "./ask-words";

/**
 * The "Do it" half of the shared conversation (night 4, job DR part B). The layout hands the session `DoItOptions` only when the tasks are switched on and the person may make a plan; the session then has a mode ("Ask" or "Do it"), and in
 * "Do it" mode what is typed or spoken becomes a plan (a PLAN CARD in the thread) instead of a question. The tasks of this conversation live HERE, in the one session, so the thread keeps them when the Today card and the floating panel take turns
 * drawing it. Nothing is stored in the browser: a hard reload starts a new thread (the tasks themselves are on the Tasks page).
 */
export type DoItOptions = {
  actions: TaskActions;
  powers: TaskPowers;
  /** The words of the tasks (`tk.` and `pc.`), in the person's language. */
  words: AskWords;
};
export type Mode = "ask" | "do";
/** What one exchange of the thread holds when it was a task: the task (by id, its latest copy is on the board) or why a plan could not be made. */
export type TaskEntry = { id: string } | { error: TaskError };

export type DoItState = DoItOptions & {
  tasks: Readonly<Record<string, TaskOut>>;
  reports: Readonly<Record<string, ReportOut>>;
  adopt: (task: TaskOut) => void;
  adoptReport: (id: string, report: ReportOut) => void;
  /** The ready-made tasks of this workspace, once loaded (null = not asked yet, "failed" = could not be read). */
  templates: readonly TemplateChoice[] | "failed" | null;
  loadTemplates: () => void;
};

export function useDoIt(options: DoItOptions | null | undefined): DoItState | null {
  const [tasks, setTasks] = React.useState<Record<string, TaskOut>>({});
  const [reports, setReports] = React.useState<Record<string, ReportOut>>({});
  const [templates, setTemplates] = React.useState<readonly TemplateChoice[] | "failed" | null>(null);
  const asked = React.useRef(false);
  const adopt = React.useCallback((task: TaskOut) => setTasks((m) => ({ ...m, [task.id]: task })), []);
  const adoptReport = React.useCallback((id: string, report: ReportOut) => setReports((m) => ({ ...m, [id]: report })), []);
  const templatesAction = options?.actions.templates;
  const loadTemplates = React.useCallback(() => {
    if (asked.current || !templatesAction) return;
    asked.current = true;
    templatesAction().then(
      (got) => setTemplates(got.ok ? got.templates : "failed"),
      () => setTemplates("failed"),
    );
  }, [templatesAction]);
  if (!options) return null;
  return { ...options, tasks, reports, adopt, adoptReport, templates, loadTemplates };
}

/** The words the "Do it" parts read, with the key as the fallback (never blank). */
export const doItWord = (words: AskWords, key: string): string => words[key] ?? key;
