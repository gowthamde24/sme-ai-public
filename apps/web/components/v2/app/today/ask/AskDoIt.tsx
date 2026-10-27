"use client";

import Link from "next/link";
import * as React from "react";

import type { TaskOut } from "@/lib/tasks/types";
import { isOver } from "@/lib/tasks/types";

import { alertBox, btnQuiet, fieldInput, mutedText } from "../../ui";
import { TaskLive } from "../../tasks/TaskLive";
import { TaskPlanCard } from "../../tasks/TaskPlanCard";
import { makeT } from "../../words";
import type { TaskEntry } from "./use-do-it";
import type { AskSession } from "./use-ask-session";

const seg = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold";
const chipClass = "inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2";

/**
 * The "Ask | Do it" switch of the Ask box and, in "Do it" mode, the ready-made task chips that take the place of the question chips (a chip puts its example instruction in the line for the owner to change, then Send). A chunk of its own
 * (night 4, tasks): Today's route does not carry it; AskDoItLazy loads it once the conversation has arrived and "Do it" is on for this person.
 */
export function DoItBar({ session }: { session: AskSession }) {
  const d = session.doIt;
  const loadTemplates = d?.loadTemplates;
  const mode = session.mode;
  React.useEffect(() => {
    if (mode === "do") loadTemplates?.();
  }, [mode, loadTemplates]);
  if (!d) return null;
  const t = makeT(d.words);
  const choices = Array.isArray(d.templates) ? d.templates : [];
  return (
    <div data-ask="do-it-bar" className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label={t("tk.d.mode")} className="inline-flex self-start rounded-full border border-edge bg-surface p-1">
        <button type="button" aria-pressed={mode === "ask"} onClick={() => session.setMode("ask")} className={`${seg} ${mode === "ask" ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}>
          {t("tk.d.ask")}
        </button>
        <button type="button" aria-pressed={mode === "do"} onClick={() => session.setMode("do")} className={`${seg} ${mode === "do" ? "bg-charcoal text-on-charcoal" : "text-ink hover:bg-surface-2"}`}>
          {t("tk.d.do")}
        </button>
      </div>
      {mode === "do" ? (
        <>
          <p className="text-sm text-muted">{t("tk.d.hint")}</p>
          {!session.asking ? (
            <ul data-ask="chips" data-ask-kind="tasks" className="flex flex-wrap gap-2" aria-label={t("tk.composer.chips")}>
              {choices.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-write
                    className={chipClass}
                    onClick={() => {
                      session.setText((d.words[`tk.ex.${c.id}`] ?? c.example).slice(0, 500));
                      document.getElementById("ask-input")?.focus();
                    }}
                  >
                    {d.words[`tk.t.${c.id}`] ?? c.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {d.templates === "failed" ? <p className="text-sm text-muted">{t("tk.d.nochips")}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** One task in the thread: the plan card with Approve all, then the live progress, then the short answer of the report with a link to the full one. */
export function DoItEntry({ session, entry }: { session: AskSession; entry: TaskEntry }) {
  const d = session.doIt;
  const id = "id" in entry ? entry.id : null;
  const task: TaskOut | null = d && id ? (d.tasks[id] ?? null) : null;
  const report = d && id ? (d.reports[id] ?? null) : null;
  const over = task ? isOver(task.status) : false;
  const adoptReport = d?.adoptReport;
  const reportAction = d?.actions.report;
  React.useEffect(() => {
    if (!over || report || !id || !adoptReport || !reportAction) return;
    let gone = false;
    void reportAction(id)
      .then((got) => {
        if (!gone && got.ok) adoptReport(id, got.report);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [over, report, id, adoptReport, reportAction]);
  if (!d) return null;
  const t = makeT(d.words);
  if ("error" in entry)
    return (
      <p role="alert" data-ask="task-error" className={`${alertBox} !mt-2`}>
        {t(`tk.err.${entry.error}`)}
      </p>
    );
  if (!task) return null;
  const href = `${session.base}/tasks/${task.id}`;
  const open = (key: string) => (
    <Link href={href} prefetch={false} className={`${btnQuiet} self-start`}>
      {t(key)}
    </Link>
  );
  if (task.status === "needs_answer") return <Question session={session} task={task} />;
  if (task.status === "planned" && (task.plan?.contacts_total ?? 0) === 0)
    return (
      <div data-ask="task" data-task-state="nobody" className="mt-2 flex flex-col gap-2">
        <p className="text-base font-semibold">{t("tk.nobody.title")}</p>
        <p className="text-base">{t("tk.nobody.text")}</p>
        <Link href={`${session.base}/tasks?new=1&instruction=${encodeURIComponent(task.instruction.slice(0, 500))}`} prefetch={false} className={`${btnQuiet} self-start`}>
          {t("tk.d.edit")}
        </Link>
      </div>
    );
  const onTask = d.adopt;
  return (
    <div data-ask="task" data-task-state={task.status} className="mt-2 flex flex-col gap-3">
      {task.status === "planned" ? (
        <>
          <TaskPlanCard task={task} words={d.words} lang={session.lang} actions={d.actions} powers={d.powers} onTask={onTask} />
          {open("tk.d.openplan")}
        </>
      ) : null}
      {task.status === "approved" || task.status === "running" || task.status === "paused" ? (
        <>
          <TaskLive task={task} words={d.words} actions={d.actions} powers={d.powers} onTask={onTask} />
          {open("tk.d.open")}
        </>
      ) : null}
      {over ? (
        <>
          {report ? (
            <p data-part="short-answer" lang={task.language} className="font-display text-xl font-bold leading-snug [overflow-wrap:anywhere]">
              {report.short_answer}
            </p>
          ) : (
            <p role="status" className={`${mutedText} !mt-0`}>
              {t("tk.r.loading")}
            </p>
          )}
          <p className={`${mutedText} !mt-0`}>{t("tk.r.simulated")}</p>
          {open("tk.d.openreport")}
        </>
      ) : null}
    </div>
  );
}

function Question({ session, task }: { session: AskSession; task: TaskOut }) {
  const d = session.doIt!;
  const t = makeT(d.words);
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const got = await d.actions.answer(task.id, answer.trim());
      if (got.ok) d.adopt(got.task);
      else setError(got.error);
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  return (
    <form data-ask="task" data-task-state="needs_answer" onSubmit={(e) => void send(e)} className="mt-2 flex flex-col gap-2">
      <p lang={task.language} className="text-base font-semibold [overflow-wrap:anywhere]">
        {task.question}
      </p>
      <label htmlFor={`ask-answer-${task.id}`} className="sr-only">
        {t("tk.q.label")}
      </label>
      <input id={`ask-answer-${task.id}`} value={answer} maxLength={500} onChange={(e) => setAnswer(e.target.value)} className={fieldInput} disabled={!d.powers.plan} />
      <button type="submit" className={`${btnQuiet} self-start`} disabled={busy || answer.trim() === ""}>
        {busy ? t("tk.q.sending") : t("tk.q.send")}
      </button>
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`tk.err.${error}`)}
        </p>
      ) : null}
    </form>
  );
}
