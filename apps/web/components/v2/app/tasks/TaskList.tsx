import Link from "next/link";

import { progressCounts, type TaskOut } from "@/lib/tasks/types";

import { btnQuiet, listItemCard, listPlain, mutedText, pillAmber, pillBrand, pillGreen, pillNeutral } from "../ui";
import { makeT, type Words } from "../words";
import { dayText, TASK_STATE_WORD } from "./task-format";

const PILL: Record<TaskOut["status"], string> = { needs_answer: pillAmber, planned: pillBrand, approved: pillGreen, running: pillGreen, paused: pillAmber, done: pillGreen, cancelled: pillNeutral };

/** One of the three lists of the Tasks page (night 4, job DR part B): what was asked (as plain text), its state, "N of M" and a link to open it. No hooks: a server page draws it. */
export function TaskList({ tasks, words, base, lang, empty }: { tasks: readonly TaskOut[]; words: Words; base: string; lang: string; empty: string }) {
  const t = makeT(words);
  if (tasks.length === 0) return <p className={mutedText}>{empty}</p>;
  return (
    <ul data-part="task-list" className={listPlain}>
      {tasks.map((task) => {
        const { finished, of } = progressCounts(task.progress);
        return (
          <li key={task.id} className={`${listItemCard} flex flex-col gap-2`}>
            <p className="line-clamp-3 text-base font-semibold [overflow-wrap:anywhere]">{task.instruction}</p>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className={PILL[task.status]}>{t(TASK_STATE_WORD[task.status])}</span>
              {of > 0 && task.status !== "planned" ? <span>{t("tk.live.of", { done: finished, total: of })}</span> : null}
              {task.plan ? <span>{t("tk.list.people", { n: task.plan.contacts_total })}</span> : null}
              <span>{dayText(task.created_at.slice(0, 10), lang)}</span>
            </p>
            <Link href={`${base}/tasks/${task.id}`} className={`${btnQuiet} self-start`}>
              {t(task.status === "done" || task.status === "cancelled" ? "tk.list.report" : task.status === "planned" || task.status === "needs_answer" ? "tk.list.review" : "tk.list.open")}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
