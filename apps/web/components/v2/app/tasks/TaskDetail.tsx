"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS } from "@/lib/assistant/types";
import { parseList } from "@/lib/tasks/list";
import { INSTRUCTION_MAX, isOver, type ReportOut, type TaskContactOut, type TaskLang, type TaskOut } from "@/lib/tasks/types";

import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, fieldTextarea, mutedText, noteBox, surface } from "../ui";
import { makeT, type Words } from "../words";
import type { TaskActions, TaskPowers } from "./task-actions";
import { langName, noteText } from "./task-format";
import { TaskLive } from "./TaskLive";
import { TaskPlanCard } from "./TaskPlanCard";
import { TaskReport } from "./TaskReport";

/**
 * The interactive part of a task's page (night 4, job DR part B). It holds the ONE copy of the task (the progress poll, every button and the plan card hand their answer to it) and draws what the task's state needs: the one question
 * (status `needs_answer`: answer it), the "nobody found" card (no approve button: say who, or give a list), the plan card with its language choice, the live progress with its buttons, and the report once it is over (read when
 * the task finishes while the page is open). The language of the customers cannot change on a plan that exists, so choosing another one makes a NEW plan from the same instruction.
 */
export function TaskDetail({ initialTask, initialReport, everyone, words, lang, base, actions, powers }: { initialTask: TaskOut; initialReport: ReportOut | null; everyone: readonly TaskContactOut[] | null; words: Words; lang: string; base: string; actions: TaskActions; powers: TaskPowers }) {
  const t = makeT(words);
  const router = useRouter();
  const [task, setTask] = React.useState(initialTask);
  const [report, setReport] = React.useState<ReportOut | null>(initialReport);
  const [reportFailed, setReportFailed] = React.useState(false);
  const over = isOver(task.status);
  const taskId = task.id;
  React.useEffect(() => {
    if (!over || report !== null) return;
    let gone = false;
    void actions
      .report(taskId)
      .then((got) => {
        if (gone) return;
        if (got.ok) setReport(got.report);
        else setReportFailed(true);
      })
      .catch(() => {
        if (!gone) setReportFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [over, report, taskId, actions]);

  if (task.status === "needs_answer") return <TaskQuestion task={task} words={words} actions={actions} powers={powers} onTask={setTask} />;
  const nobody = task.status === "planned" && (task.plan?.contacts_total ?? 0) === 0;
  return (
    <div className="flex flex-col gap-6">
      {nobody ? (
        <TaskNobody task={task} words={words} actions={actions} powers={powers} onNew={(id) => router.push(`${base}/tasks/${id}`)} />
      ) : (
        <>
          {task.status !== "planned" && !over ? <TaskLive task={task} words={words} actions={actions} powers={powers} onTask={setTask} /> : null}
          {over ? (
            report ? (
              <TaskReport report={report} task={task} words={words} />
            ) : (
              <p role="status" className={mutedText}>
                {reportFailed ? t("tk.r.failed") : t("tk.r.loading")}
              </p>
            )
          ) : null}
          {over ? (
            <details data-part="plan-folded" className={surface}>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("tk.plan.show")}</summary>
              <div className="mt-3">
                <TaskPlanCard task={task} words={words} lang={lang} actions={actions} powers={powers} onTask={setTask} everyone={everyone} />
              </div>
            </details>
          ) : (
            <TaskPlanCard task={task} words={words} lang={lang} actions={actions} powers={powers} onTask={setTask} everyone={everyone} />
          )}
          {task.status === "planned" && powers.plan ? <ReplanLanguage task={task} words={words} actions={actions} onNew={(id) => router.push(`${base}/tasks/${id}`)} /> : null}
        </>
      )}
      <p className={`${mutedText} !mt-0`}>
        <Link href={`${base}/tasks`} className="font-semibold text-brand-text underline">
          {t("tk.back")}
        </Link>
      </p>
    </div>
  );
}

function TaskQuestion({ task, words, actions, powers, onTask }: { task: TaskOut; words: Words; actions: TaskActions; powers: TaskPowers; onTask: (t: TaskOut) => void }) {
  const t = makeT(words);
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await actions.answer(task.id, answer.trim());
      if (got.ok) onTask(got.task);
      else setError(got.error);
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  return (
    <section data-part="question" aria-labelledby="task-q-h" className={`${surface} flex flex-col gap-3`}>
      <h2 id="task-q-h" className="font-display text-xl font-bold leading-tight">
        {t("tk.q.title")}
      </h2>
      <p lang={task.language} className="text-lg font-semibold [overflow-wrap:anywhere]">
        {task.question}
      </p>
      {powers.plan ? (
        <>
          <label htmlFor="task-answer" className={fieldLabel}>
            {t("tk.q.label")}
          </label>
          <textarea id="task-answer" rows={3} maxLength={500} value={answer} onChange={(e) => setAnswer(e.target.value)} className={fieldTextarea} />
          <button type="button" className={btnMain} disabled={busy || answer.trim() === ""} onClick={() => void send()}>
            {busy ? t("tk.q.sending") : t("tk.q.send")}
          </button>
          <p className={`${mutedText} !mt-0`}>{t("tk.q.once")}</p>
        </>
      ) : (
        <p className={`${mutedText} !mt-0`}>{t("tk.viewer")}</p>
      )}
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`tk.err.${error}`)}
        </p>
      ) : null}
    </section>
  );
}

function TaskNobody({ task, words, actions, powers, onNew }: { task: TaskOut; words: Words; actions: TaskActions; powers: TaskPowers; onNew: (id: string) => void }) {
  const t = makeT(words);
  const [text, setText] = React.useState(task.instruction);
  const [list, setList] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const parsed = parseList(list);
  const again = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await actions.plan(crypto.randomUUID(), text.trim(), task.language, parsed.people);
      if (got.ok) onNew(got.task.id);
      else setError(got.error);
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  return (
    <section data-part="nobody" aria-labelledby="task-nobody-h" className={`${surface} flex flex-col gap-3`}>
      <h2 id="task-nobody-h" className="font-display text-xl font-bold leading-tight">
        {t("tk.nobody.title")}
      </h2>
      <p className="text-base">{t("tk.nobody.text")}</p>
      {(task.plan?.notes ?? []).length > 0 ? (
        <ul className="list-inside list-disc text-sm text-muted">
          {(task.plan?.notes ?? []).map((n, i) => (
            <li key={i}>{noteText(n, t)}</li>
          ))}
        </ul>
      ) : null}
      {powers.plan ? (
        <>
          <label htmlFor="nobody-text" className={fieldLabel}>
            {t("tk.composer.label")}
          </label>
          <textarea id="nobody-text" rows={3} maxLength={INSTRUCTION_MAX} value={text} onChange={(e) => setText(e.target.value)} className={fieldTextarea} />
          <label htmlFor="nobody-list" className={fieldLabel}>
            {t("tk.composer.list")}
          </label>
          <textarea id="nobody-list" rows={4} value={list} onChange={(e) => setList(e.target.value)} className={fieldTextarea} />
          <p className={`${mutedText} !mt-0`}>{t("tk.composer.list.help")}</p>
          {parsed.people.length > 0 || parsed.skipped > 0 ? <p className={`${mutedText} !mt-0`}>{t("tk.composer.list.count", { n: parsed.people.length, skipped: parsed.skipped })}</p> : null}
          <button type="button" className={btnMain} disabled={busy || text.trim().length < 3} onClick={() => void again()}>
            {busy ? t("tk.composer.working") : t("tk.nobody.again")}
          </button>
        </>
      ) : (
        <p className={`${mutedText} !mt-0`}>{t("tk.viewer")}</p>
      )}
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`tk.err.${error}`)}
        </p>
      ) : null}
    </section>
  );
}

function ReplanLanguage({ task, words, actions, onNew }: { task: TaskOut; words: Words; actions: TaskActions; onNew: (id: string) => void }) {
  const t = makeT(words);
  const [choice, setChoice] = React.useState<TaskLang>(task.language);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await actions.plan(crypto.randomUUID(), task.instruction, choice);
      if (got.ok) onNew(got.task.id);
      else setError(got.error);
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  return (
    <section data-part="language" aria-labelledby="task-lang-h" className={`${surface} flex flex-col gap-2`}>
      <h2 id="task-lang-h" className="text-base font-semibold">
        {t("tk.lang.title")}
      </h2>
      <p className={`${mutedText} !mt-0`}>{t("tk.lang.now", { lang: langName(task.language) })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="task-lang" className={fieldLabel}>
            {t("tk.lang.label")}
          </label>
          <select id="task-lang" value={choice} onChange={(e) => setChoice(e.target.value as TaskLang)} className={fieldInput}>
            {CALL_LANGS.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={btnQuiet} disabled={busy || choice === task.language} onClick={() => void go()}>
          {busy ? t("tk.composer.working") : t("tk.lang.replan")}
        </button>
      </div>
      <p className={`${mutedText} !mt-0`}>{t("tk.lang.help")}</p>
      {error ? (
        <p role="alert" className={`${noteBox} !mt-0 text-red-text`}>
          {t(`tk.err.${error}`)}
        </p>
      ) : null}
    </section>
  );
}
