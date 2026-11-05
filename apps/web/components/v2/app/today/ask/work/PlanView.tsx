"use client";

import { Check, CircleAlert, Undo2 } from "lucide-react";
import * as React from "react";

import type { PlanOutcome } from "@/lib/assistant-work/client";
import type { WorkPlan, WorkStep } from "@/lib/assistant-work/types";

import { btnDo, btnOther, btnSmall, type WorkEnv } from "./work-env";
import { useCardState } from "./work-store";

const PROBLEM: Readonly<Record<string, string>> = { mfa: "bv.chat.err.mfa", forbidden: "bv.chat.err.forbidden", state: "bv.work.plan.err.state", expired: "bv.work.plan.expired", down: "bv.chat.err.down" };

function StepLine({ step, t }: { step: WorkStep; t: WorkEnv["t"] }) {
  const mark = step.status === "proposed" ? null : step.status === "failed" ? "text-red-text" : step.status === "done" ? "text-green-text" : "text-muted";
  return (
    <li data-work="step" data-status={step.status} className="[overflow-wrap:anywhere]">
      <span>{step.summary}</span>
      {mark ? (
        <span className={`ml-1 text-sm font-semibold ${mark}`}>
          {" · "}
          {t(`bv.work.step.${step.status}`)}
          {step.status === "failed" && step.error ? ` · ${t(`bv.work.step.err.${step.error}`)}` : ""}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The plan the assistant will carry out: its steps (one or more tools, each with the tool's own summary) and Do it / Change / Cancel. Nothing runs until "Do it".
 * A SENSITIVE plan (money, sending or calling, members and roles, deleting, billing, secrets) asks again ("Are you sure?") and is the Owner's alone; anyone else reads "Only the owner can approve this".
 * After it ran: "Done · Undo" (Undo only when a step that ran declares one), then "Undone". A step that failed says so; a plan where every step failed says nothing was changed.
 */
export function PlanView({ plan: given, env }: { plan: WorkPlan; env: WorkEnv }) {
  const { t, store, transport } = env;
  const plan = useCardState(store, given.planId)?.plan ?? given;
  const [busy, setBusy] = React.useState(false);
  const [sure, setSure] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const mayDecide = !plan.ownerOnly || env.role === "owner";
  const settle = (out: PlanOutcome, undoing = false) => {
    setBusy(false);
    setSure(false);
    if (out.ok) store.set(plan.planId, { plan: out.plan });
    else if (out.error === "expired") store.set(plan.planId, { plan: { ...plan, status: "expired" } });
    else setProblem(undoing && out.error === "down" ? "bv.work.plan.undo.failed" : PROBLEM[out.error]);
  };
  const decide = async (decision: "do" | "cancel", confirmed: boolean) => {
    setBusy(true);
    setProblem(null);
    if (decision === "do") store.set(plan.planId, { plan: { ...plan, status: "running" } });
    const out = await transport.decide(plan.planId, decision, confirmed);
    if (!out.ok && decision === "do") store.set(plan.planId, { plan: { ...plan, status: "proposed" } });
    settle(out);
  };
  const undo = async () => {
    setBusy(true);
    setProblem(null);
    settle(await transport.undo(plan.planId), true);
  };
  const ran = plan.status === "done" || plan.status === "partly_done";
  const canUndo = ran && plan.steps.some((s) => s.status === "done" && s.undoable);
  return (
    <section data-work="plan" data-status={plan.status} data-sensitive={plan.sensitive ?? undefined} aria-label={t("bv.work.plan.label")} className="flex flex-col gap-2">
      <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{plan.title}</h3>
      <ol aria-label={t("bv.work.plan.steps")} className="list-decimal space-y-1 pl-5 text-sm">
        {plan.steps.map((s, i) => (
          <StepLine key={i} step={s} t={t} />
        ))}
      </ol>
      {plan.status === "proposed" && !mayDecide ? (
        <p data-work="owner-only" role="note" className="text-sm font-semibold text-amber-text">
          {t("bv.work.plan.owner")}
        </p>
      ) : null}
      {plan.status === "proposed" && mayDecide && !sure ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-work="do" data-write disabled={busy} onClick={() => (plan.sensitive ? setSure(true) : void decide("do", false))} className={btnDo}>
            {t("bv.work.plan.do")}
          </button>
          <button type="button" data-work="change" disabled={busy} onClick={() => env.onChange(`${t("bv.work.plan.change.prefill")} `)} className={btnOther}>
            {t("bv.work.plan.change")}
          </button>
          <button type="button" data-work="cancel" data-write disabled={busy} onClick={() => void decide("cancel", false)} className={btnOther}>
            {t("bv.work.plan.cancel")}
          </button>
        </div>
      ) : null}
      {plan.status === "proposed" && mayDecide && sure && plan.sensitive ? (
        <div data-work="sure" role="group" aria-label={t("bv.work.plan.sure.title")} className="rounded-lg border border-amber-text bg-amber-bg p-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-text">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("bv.work.plan.sure.title")} {t(`bv.work.plan.sure.${plan.sensitive}`)}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-work="confirm" data-write disabled={busy} onClick={() => void decide("do", true)} className={btnDo}>
              {t("bv.work.plan.sure.yes")}
            </button>
            <button type="button" data-work="back" disabled={busy} onClick={() => setSure(false)} className={btnOther}>
              {t("bv.work.plan.sure.back")}
            </button>
          </div>
        </div>
      ) : null}
      {plan.status === "running" ? (
        <p role="status" className="text-sm font-semibold text-muted">
          {t("bv.work.plan.working")}
        </p>
      ) : null}
      {ran ? (
        <div data-work="done" role="status" className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-green-text bg-green-bg px-3 text-sm font-semibold text-green-text">
            <Check className="size-4" aria-hidden="true" />
            {t(plan.status === "done" ? "bv.work.plan.done" : "bv.work.plan.partly")}
          </span>
          {canUndo ? (
            <button type="button" data-work="undo" data-write disabled={busy} onClick={() => void undo()} className={btnSmall}>
              <Undo2 className="mr-1 size-4" aria-hidden="true" />
              {t("bv.work.plan.undo")}
            </button>
          ) : null}
        </div>
      ) : null}
      {plan.status === "failed" || plan.status === "cancelled" || plan.status === "expired" || plan.status === "undone" ? (
        <p data-work="state" role="status" className={`text-sm font-semibold ${plan.status === "failed" ? "text-red-text" : "text-muted"}`}>
          {t(`bv.work.plan.${plan.status}`)}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-red-text">
          {t(problem)}
        </p>
      ) : null}
    </section>
  );
}
