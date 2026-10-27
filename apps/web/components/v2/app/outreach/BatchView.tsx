"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { BatchAnswer, BatchItem, Done } from "@/lib/outreach/types";

import { PlanCard, type ApproveResult } from "../plan-card/PlanCard";
import { alertBox, btnMain, btnQuiet, mutedText, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * One batch of leads to call or message (night 4, part A3): the PLAN CARD while it waits (who, goal, what Vijaya asks, when, the estimate, the limits, ONE "Approve all"), then the progress and the controls (pause, resume, cancel),
 * and the people in it. The page hands over what the server read; while the batch runs the page refreshes itself every few seconds (the server reads again). Nothing here calls or sends: it asks the actions, which ask the API.
 */
export type BatchActions = {
  exclude: (contactId: string, excluded: boolean) => Promise<Done<BatchAnswer>>;
  approve: (planSha256: string) => Promise<Done<BatchAnswer>>;
  control: (action: "pause" | "resume" | "cancel") => Promise<Done<BatchAnswer>>;
};
const REFRESH_MS = 3000;

export function BatchView({ words, initial, items, canApprove, canDecide, canCancel, simulated, channelWords, goalWord, whenText, actions, securityHref }: { words: Words; initial: BatchAnswer; items: readonly BatchItem[]; canApprove: boolean; canDecide: boolean; canCancel: boolean; simulated: boolean; channelWords: Readonly<Record<string, string>>; goalWord: string; whenText: string; actions: BatchActions; securityHref: string }) {
  const t = makeT(words);
  const router = useRouter();
  const [ans, setAns] = React.useState(initial);
  const [excluded, setExcluded] = React.useState<ReadonlySet<string>>(() => new Set(items.filter((i) => i.reason === "excluded").map((i) => i.contactId)));
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // the page reads again while a batch runs: what it hands over replaces what was here (derived during render, not in an effect)
  const [seen, setSeen] = React.useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setAns(initial);
  }
  const status = ans.batch.status;
  React.useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [status, router]);

  const onExclude = async (id: string, out: boolean) => {
    setNote(null);
    const r = await actions.exclude(id, out).catch((): Done<BatchAnswer> => ({ ok: false, error: "down" }));
    if (r.ok) {
      setAns(r.value);
      setExcluded((prev) => {
        const next = new Set(prev);
        if (out) next.add(id);
        else next.delete(id);
        return next;
      });
    } else setNote(t(r.error === "state" ? "ol.err.state" : "ol.err.exclude"));
  };
  const onApprove = async (): Promise<ApproveResult> => {
    const r = await actions.approve(ans.batch.planSha256);
    if (r.ok) {
      setAns(r.value);
      router.refresh();
      return { ok: true };
    }
    return { ok: false, error: r.error === "mfa" || r.error === "changed" || r.error === "read_only" ? r.error : "down" };
  };
  const control = async (action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    setNote(null);
    const r = await actions.control(action).catch((): Done<BatchAnswer> => ({ ok: false, error: "down" }));
    setBusy(false);
    if (r.ok) {
      setAns(r.value);
      router.refresh();
    } else setNote(t(r.error === "mfa" ? "pc.err.mfa" : r.error === "read_only" ? "pc.err.read_only" : "ol.err.control"));
  };

  const plan = ans.plan;
  const skipped = Object.entries(plan.skipped).filter(([, n]) => n > 0).map(([k, n]) => `${t(`ol.skip.${k}` as "ol.skip.other")} ${n}`);
  const goal = t(goalWord as "ld.goal.general");
  const pr = ans.progress;
  const state = status === "planned" ? "planned" : status === "running" ? "running" : status === "paused" ? "paused" : status === "done" ? "done" : "cancelled";
  return (
    <div data-part="batch" data-status={status} className="flex flex-col gap-4">
      <PlanCard
        words={words}
        title={ans.batch.name}
        who={{ count: plan.ready + excluded.size, sample: plan.sample.map((s) => ({ id: s.contactId, name: s.city ? `${s.nameMasked}, ${s.city}` : s.nameMasked })), excluded, skipped }}
        goal={goal}
        questions={ans.batch.questions}
        channel={channelWords[ans.batch.channel] ?? ans.batch.channel}
        when={whenText}
        estimate={{ minutes: plan.estimatedMinutes, messages: plan.estimatedMessages, costPaise: plan.estimatedCostPaise }}
        limits={{ callsPerDay: plan.maxCallsPerDay, totalMinutes: plan.maxTotalMinutes }}
        simulated={simulated}
        state={state}
        canApprove={canApprove}
        onExclude={(id, out) => void (canDecide ? onExclude(id, out) : setNote(t("ol.err.exclude.role")))}
        onApprove={onApprove}
        securityHref={securityHref}
      />
      {note ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {note}
        </p>
      ) : null}
      {pr ? (
        <section data-part="progress" aria-label={t("ol.progress")} className={`${surface} flex flex-col gap-3`}>
          <h3 className="font-display text-lg font-bold">{t("ol.progress")}</h3>
          <progress value={pr.done} max={Math.max(1, pr.total)} aria-label={t("ol.progress.of", { done: pr.done, total: pr.total })} className="h-3 w-full accent-brand-edge" />
          <p aria-live="polite" className="text-base font-semibold">
            {t("ol.progress.of", { done: pr.done, total: pr.total })}
          </p>
          <p className={`${mutedText} !mt-0`}>{t("ol.progress.detail", { calls: pr.callsMade, connected: pr.connected, interested: pr.interested, minutes: pr.minutesUsed })}</p>
          {status === "paused" ? <p className={`${okBox} !mt-0`}>{t(ans.batch.pausedReason === "cap_calls" ? "ol.paused.cap_calls" : ans.batch.pausedReason === "cap_minutes" ? "ol.paused.cap_minutes" : ans.batch.pausedReason === "billing" ? "ol.paused.billing" : "ol.paused.owner")}</p> : null}
          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              {status === "running" ? (
                <button type="button" className={btnQuiet} disabled={busy} onClick={() => void control("pause")}>
                  {t("ol.pause")}
                </button>
              ) : null}
              {status === "paused" ? (
                <button type="button" className={btnMain} disabled={busy} onClick={() => void control("resume")}>
                  {t("ol.resume")}
                </button>
              ) : null}
              {canCancel && (status === "running" || status === "paused") ? (
                <button type="button" className={btnQuiet} disabled={busy} onClick={() => void control("cancel")}>
                  {t("ol.cancel")}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {canCancel && status === "planned" ? (
        <p className={mutedText}>{t("ol.planned.note")}</p>
      ) : null}
      {items.length > 0 ? (
        <details data-part="people" className={surface}>
          <summary className="min-h-11 cursor-pointer text-base font-semibold">{t("ol.people", { n: items.length })}</summary>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-words font-medium">{i.name}</span>
                <span className="text-sm text-muted">{i.status === "skipped" ? t(`ol.skip.${i.reason ?? "other"}` as "ol.skip.other") : t(`ol.item.${i.status}` as "ol.item.waiting")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
