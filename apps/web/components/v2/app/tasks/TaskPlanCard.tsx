"use client";

import * as React from "react";

import { formatRupeesShort } from "@/lib/money";
import type { TaskContactOut, TaskOut } from "@/lib/tasks/types";

import { PlanCard, type ApproveResult } from "../plan-card/PlanCard";
import { checkBox, checkRow, mutedText, pillNeutral } from "../ui";
import { makeT, type Words } from "../words";
import type { TaskActions, TaskPowers } from "./task-actions";
import { CONTACT_STATE_WORD, noteText, whenText } from "./task-format";

/**
 * The PLAN CARD of one task (night 4, job DR part B), made from the shared card (components/v2/app/plan-card): who (a few names with a tick to leave one out, and "See everyone" with all of them), the goal, what Vijaya asks, when, the
 * estimate the system counted, the spending limit, the WhatsApp wording, and ONE "Approve all". The parent owns the task (`onTask` gets each new copy: leaving someone out changes the plan's hash, and an approval must send the newest);
 * this keeps only the ticks. Approving is the Owner's, with the second factor: the card's own sentences say why an approval did not happen, and the ones it has no word for (WhatsApp not ready, a school's money words, a task that moved on)
 * get a sentence of ours under it.
 */
export function TaskPlanCard({ task, words, lang, actions, powers, onTask, everyone = null, securityHref = "/app/security" }: { task: TaskOut; words: Words; lang: string; actions: TaskActions; powers: TaskPowers; onTask: (t: TaskOut) => void; /** All the people of the task, when the page has read them (the list under "See everyone"). */ everyone?: readonly TaskContactOut[] | null; securityHref?: string }) {
  const t = makeT(words);
  const plan = task.plan;
  const [left, setLeft] = React.useState<ReadonlySet<string>>(() => new Set((everyone ?? []).filter((c) => c.status === "excluded").map((c) => c.contact_id)));
  const [note, setNote] = React.useState<string | null>(null);
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const taskRef = React.useRef(task);
  React.useEffect(() => {
    taskRef.current = task;
  });
  if (!plan) return null;
  const editable = task.status === "planned" && powers.plan;
  const sample = (everyone && everyone.length > 0 ? everyone.slice(0, 5).map((c) => ({ id: c.contact_id, name: c.name })) : plan.contacts_sample.map((s) => ({ id: s.contact_id, name: s.name ?? "" }))).filter((s) => s.name !== "");
  const exclude = (id: string, excluded: boolean) => {
    if (!editable) return;
    setLeft((was) => {
      const next = new Set(was);
      if (excluded) next.add(id);
      else next.delete(id);
      return next;
    });
    setNote(null);
    queue.current = queue.current.then(async () => {
      try {
        const got = await actions.exclude(taskRef.current.id, [id], excluded);
        if (got.ok) onTask(got.task);
        else {
          setLeft((was) => {
            const next = new Set(was);
            if (excluded) next.delete(id);
            else next.add(id);
            return next;
          });
          setNote(got.error);
        }
      } catch {
        setNote("down");
      }
    });
  };
  const approve = async (): Promise<ApproveResult> => {
    const current = taskRef.current;
    if (!current.plan_sha256) return { ok: false, error: "down" };
    const got = await actions.approve(current.id, current.plan_sha256, null);
    if (got.ok) {
      setNote(null);
      onTask(got.task);
      return { ok: true };
    }
    if (got.error === "changed") {
      const fresh = await actions.progress(current.id).catch(() => null);
      if (fresh?.ok) onTask(fresh.task);
    }
    if (got.error === "mfa" || got.error === "changed" || got.error === "read_only" || got.error === "nobody") return { ok: false, error: got.error };
    setNote(got.error);
    return { ok: false, error: "down" };
  };
  const includedCount = plan.contacts_total - left.size;
  const unmatched = plan.unmatched.length > 0 ? t("tk.unmatched", { n: plan.unmatched.length, last: plan.unmatched.slice(0, 5).map((u) => `…${u.phone_last4}`).join(", ") }) : null;
  const notes = [...plan.notes.map((n) => noteText(n, t)), ...(unmatched ? [unmatched] : [])];
  const template = task.template === "custom" ? null : t(`tk.t.${task.template}`);
  const rows = task.status === "planned" ? (everyone ?? []) : [];
  return (
    <>
      <PlanCard
        words={words}
        title={template ? t("tk.plan.title", { what: template }) : t("tk.plan.title.custom")}
        who={{ count: plan.contacts_total, sample, excluded: left }}
        goal={plan.goal}
        questions={plan.questions.map((q) => q.text)}
        channel={t(`pc.channel.${plan.channel}`)}
        when={whenText(plan.window, t, lang)}
        estimate={task.estimate ? { minutes: task.estimate.minutes, calls: task.estimate.calls, messages: task.estimate.messages, costPaise: task.estimate.cost_paise } : {}}
        limits={task.cap_paise !== null ? { capPaise: task.cap_paise } : {}}
        notes={notes}
        simulated={task.simulated}
        state={task.status === "needs_answer" ? "planned" : task.status}
        canApprove={powers.approve && includedCount > 0}
        onExclude={exclude}
        onApprove={approve}
        securityHref={securityHref}
        detail={
          <>
            {plan.message_text ? (
              <div data-part="message" className="mt-2 rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-sm font-semibold text-muted">{t("tk.message.title")}</p>
                <p lang={task.language} className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
                  {plan.message_text}
                </p>
              </div>
            ) : null}
            {rows.length > 0 ? (
              <details data-part="everyone" className="mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("tk.everyone", { n: rows.length })}</summary>
                <ul className="mt-1 flex flex-col">
                  {rows.map((c) => {
                    const out = left.has(c.contact_id);
                    return (
                      <li key={c.contact_id}>
                        <label className={checkRow}>
                          <input type="checkbox" className={checkBox} checked={!out} disabled={!editable} onChange={(e) => exclude(c.contact_id, !e.target.checked)} />
                          <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${out ? "text-muted line-through" : ""}`}>
                            {c.name}
                            {c.phone_last4 ? <span className="text-muted"> …{c.phone_last4}</span> : null}
                          </span>
                          <span className={pillNeutral}>{t(CONTACT_STATE_WORD[out ? "excluded" : c.status === "excluded" ? "waiting" : c.status])}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
            {task.cap_paise !== null && task.estimate ? <p className={`${mutedText} !mt-1`}>{t("tk.cap.default", { cap: formatRupeesShort(task.cap_paise) })}</p> : null}
          </>
        }
      />
      {note ? (
        <p role="alert" className={`${mutedText} !mt-2 font-semibold text-red-text`}>
          {t(`tk.err.${note}`)}
        </p>
      ) : null}
    </>
  );
}
