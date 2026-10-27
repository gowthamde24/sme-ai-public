"use client";

import Link from "next/link";
import * as React from "react";

import { formatRupeesShort } from "@/lib/money";
import { isLive, percentDone, progressCounts, type TaskOut } from "@/lib/tasks/types";

import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, mutedText, okBox, pillAmber, pillBrand, pillGreen, pillNeutral, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";
import type { TaskActionResult, TaskActions, TaskPowers } from "./task-actions";
import { TASK_STATE_WORD } from "./task-format";
import { useTaskPolling } from "./use-task-polling";

/**
 * The live part of a task (night 4, job DR part B): a visible bar and "3 of 12" (a polite live region), what is happening in words, the spending so far, and the buttons Pause, Continue (after a pause, or when the run has stood still),
 * Cancel (asks first) and, when the task stopped at the spending cap, "Raise the limit and continue" for the Owner (second factor). It polls the progress while the task is approved or running; `onTask` receives every new state, so the
 * parent keeps the one copy. Everything here is a test-mode result: it says so.
 */
export function TaskLive({ task, words, actions, powers, onTask, securityHref = "/app/security" }: { task: TaskOut; words: Words; actions: TaskActions; powers: TaskPowers; onTask: (t: TaskOut) => void; securityHref?: string }) {
  const t = makeT(words);
  const { failed, stalled } = useTaskPolling(task, actions.progress, onTask);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [rupees, setRupees] = React.useState("");
  const { finished, of } = progressCounts(task.progress);
  const live = isLive(task.status);
  const capPause = task.status === "paused" && task.pause_reason === "cap";
  const mine = (got: TaskActionResult) => {
    if (got.ok) {
      setError(null);
      onTask(got.task);
    } else setError(got.error);
  };
  const act = async (run: () => Promise<TaskActionResult>) => {
    setBusy(true);
    try {
      mine(await run());
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  const raise = async () => {
    const amount = Number(rupees.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
      setError("invalid");
      return;
    }
    setBusy(true);
    try {
      const capped = await actions.setCap(task.id, Math.round(amount * 100));
      if (!capped.ok) setError(capped.error);
      else {
        const go = await actions.resume(task.id);
        mine(go.ok ? go : { ok: true, task: capped.task });
        if (!go.ok) setError(go.error);
      }
    } catch {
      setError("down");
    }
    setBusy(false);
  };
  const pill = task.status === "done" ? pillGreen : task.status === "paused" ? pillAmber : task.status === "cancelled" ? pillNeutral : pillBrand;
  return (
    <section data-part="live" data-status={task.status} aria-labelledby="task-live-h" className={`${surface} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="task-live-h" className="font-display text-xl font-bold leading-tight">
          {t("tk.live.title")}
        </h2>
        <span className={pill}>{t(TASK_STATE_WORD[task.status])}</span>
      </div>
      <progress data-part="bar" className="h-4 w-full accent-brand-text" value={finished} max={Math.max(1, of)} aria-label={t("tk.live.bar")}>
        {percentDone(task.progress)}%
      </progress>
      <p data-part="count" role="status" aria-live="polite" className="font-display text-2xl font-bold">
        {t("tk.live.of", { done: finished, total: of })}
      </p>
      <p className="text-base">
        {live ? t("tk.live.working") : task.status === "paused" ? (capPause ? t("tk.live.paused.cap", { spent: formatRupeesShort(task.spent_paise), cap: formatRupeesShort(task.cap_paise ?? 0) }) : t("tk.live.paused.owner")) : task.status === "done" ? t("tk.live.done") : task.status === "cancelled" ? t("tk.live.cancelled") : ""}
      </p>
      <p className={`${mutedText} !mt-0`} data-part="spent">
        {t("tk.live.spent", { spent: formatRupeesShort(task.spent_paise), cap: formatRupeesShort(task.cap_paise ?? 0) })} · {t("tk.live.reached", { reached: task.progress.reached, positive: task.progress.positive })}
      </p>
      <p className={`${mutedText} !mt-0`}>{t("pc.simulated")}</p>
      {failed ? (
        <p role="status" className={`${warnBox} !mt-0`}>
          {t("tk.live.failed")}
        </p>
      ) : null}
      {capPause ? (
        powers.approve ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="task-cap" className={fieldLabel}>
              {t("tk.cap.label")}
            </label>
            <input id="task-cap" inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} className={fieldInput} placeholder={String(Math.ceil((task.cap_paise ?? 0) / 100) * 2)} />
            <button type="button" className={btnMain} disabled={busy || rupees.trim() === ""} onClick={() => void raise()}>
              {t("tk.cap.save")}
            </button>
            <p className={`${mutedText} !mt-0`}>{t("tk.cap.help")}</p>
          </div>
        ) : (
          <p className={`${warnBox} !mt-0`}>{t("tk.cap.owner")}</p>
        )
      ) : null}
      {powers.move && task.status !== "done" && task.status !== "cancelled" ? (
        <div className="flex flex-wrap gap-2">
          {live ? (
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => void act(() => actions.pause(task.id))}>
              {t("tk.btn.pause")}
            </button>
          ) : null}
          {task.status === "paused" && !capPause ? (
            <button type="button" className={btnMain} disabled={busy} onClick={() => void act(() => actions.resume(task.id))}>
              {t("tk.btn.continue")}
            </button>
          ) : null}
          {live && stalled ? (
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => void act(() => actions.run(task.id))}>
              {t("tk.btn.run")}
            </button>
          ) : null}
          {!confirm ? (
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setConfirm(true)}>
              {t("tk.btn.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
      {confirm && powers.move ? (
        <div role="alertdialog" aria-label={t("tk.cancel.title")} className={`${warnBox} !mt-0 flex flex-col gap-2`}>
          <p>{t("tk.cancel.ask")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnMain}
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                void act(() => actions.cancel(task.id));
              }}
            >
              {t("tk.cancel.yes")}
            </button>
            <button type="button" className={btnQuiet} onClick={() => setConfirm(false)}>
              {t("tk.cancel.no")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t(`tk.err.${error}`)}{" "}
          {error === "mfa" ? (
            <Link href={securityHref} className="font-semibold underline">
              {t("pc.err.mfa.link")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {task.status === "done" ? (
        <p role="status" className={`${okBox} !mt-0`}>
          {t("tk.live.finished")}
        </p>
      ) : null}
    </section>
  );
}
