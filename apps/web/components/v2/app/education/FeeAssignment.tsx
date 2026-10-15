"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AssignmentOut, FeePlanOut } from "@contracts/education";

import { formatRupees } from "@/lib/money";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { card, errorLine, field, help, label, primary, quiet, secondary } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
export type FeeAssignmentActions = {
  assign: (assignmentId: string, planId: string) => Promise<{ ok: true } | Refused>;
  void: (assignmentId: string) => Promise<{ ok: true } | Refused>;
};

/**
 * The fee plan a student holds (job CS). A student with no plan can be given one (Owner, Admin): each instalment becomes a charge on the student's own account, once (the id is made with the page, so a second press writes nothing
 * twice). A student has one live plan per academic year. A plan given by mistake is taken off (the charges are voided, never deleted) after a question.
 */
export function FeeAssignment({ assignment, plans, canEdit, assignmentId, words, actions, base }: { assignment: AssignmentOut | null; plans: readonly FeePlanOut[]; canEdit: boolean; assignmentId: string; words: TodayWords; actions: FeeAssignmentActions; base: string }) {
  const router = useRouter();
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? "");
  const [ask, setAsk] = React.useState<null | "assign" | "void">(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const chosen = plans.find((p) => p.id === planId) ?? null;

  async function go() {
    if (busy || !ask) return;
    setBusy(true);
    setProblem(null);
    const out = ask === "assign" ? await actions.assign(assignmentId, planId) : await actions.void(assignment?.id ?? "");
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setAsk(null);
    router.refresh();
  }

  return (
    <section className={card} aria-labelledby="fa-h" data-part="assignment">
      <h2 id="fa-h" className="font-display text-lg font-bold">{say(words, "edu.fa.title")}</h2>
      {assignment ? (
        <>
          <p className="text-base"><Link href={`${base}/fees/plans/${assignment.plan_id}`} className="font-semibold text-brand-text underline">{assignment.plan_name}</Link> · {assignment.academic_year} · {say(words, "edu.fa.since", { date: assignment.assigned_on })}</p>
          {canEdit ? <div><button type="button" className={secondary} onClick={() => { setProblem(null); setAsk("void"); }}>{say(words, "edu.fa.void")}</button></div> : null}
        </>
      ) : canEdit ? (
        plans.length === 0 ? (
          <p className={help}>{say(words, "edu.fa.noplans")} <Link href={`${base}/fees/plans/new`} className="font-semibold underline">{say(words, "edu.plan.add")}</Link></p>
        ) : (
          <>
            <p className={help}>{say(words, "edu.fa.none")}</p>
            <div className="max-w-md">
              <label htmlFor="fa-plan" className={label}>{say(words, "edu.fa.choose")}</label>
              <select id="fa-plan" value={planId} disabled={busy} onChange={(e) => setPlanId(e.target.value)} className={field}>
                {plans.map((p) => (<option key={p.id} value={p.id}>{p.name} · {p.academic_year}</option>))}
              </select>
            </div>
            <div><button type="button" className={primary} onClick={() => { setProblem(null); setAsk("assign"); }} disabled={planId === ""}>{say(words, "edu.fa.assign")}</button></div>
          </>
        )
      ) : (
        <p className={help}>{say(words, "edu.fa.none.readonly")}</p>
      )}
      <Sheet open={ask !== null} onClose={() => !busy && setAsk(null)} busy={busy} id="fee-assignment" title={ask ? say(words, `edu.fa.${ask}.title`) : ""} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{ask === "assign" && chosen ? say(words, "edu.fa.assign.body", { plan: chosen.name }) : say(words, "edu.fa.void.body")}</p>
        {ask === "assign" && chosen ? <p className="font-display text-2xl font-bold tabular-nums">{formatRupees(chosen.total_paise)}</p> : null}
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void go()}>{busy ? say(words, "today.act.working") : ask ? say(words, `edu.fa.${ask}.go`) : ""}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </section>
  );
}
