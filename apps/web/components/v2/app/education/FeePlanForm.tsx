"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { FeePlanDetailOut, ProgrammeOut } from "@contracts/education";

import { formatRupees } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet, secondary } from "../visits/styles";
import { HEADS, isAcademicYear, readLate, readLines, type Head, type LineDraft } from "./fee-plan-logic";

type Refused = { ok: false; error: string; mfa?: boolean };
export type FeePlanFormInput = { name: string; programmeId: string; groupId: string; academicYear: string; lateKind: "none" | "fixed" | "per_day"; latePaise: number | null; lateGraceDays: number; lateCapPaise: number | null; active: boolean; lines: { head: Head; instalment_no: number; due_date: string; amount_paise: number }[] };
export type FeePlanFormActions = { save: (planId: string, input: FeePlanFormInput) => Promise<{ ok: true; planId: string } | Refused> };

const paiseText = (p: number | null) => (p === null ? "" : String(p / 100));

/**
 * A fee plan (job CS): one programme (and perhaps one section) in one academic year, with its heads (tuition, admission, transport, hostel, exam, books), the instalments with their due dates and an optional late-fee rule. A plan
 * that a student has been assigned cannot change: make a new one, copied from this. The total is added up from the rows as a person types; nothing is worked out by the system. The id is the page's, so a second press is a retry.
 */
export function FeePlanForm({ base, planId, plan, copy, programmes, defaultYear, words, actions, go }: {
  base: string; planId: string; plan: FeePlanDetailOut | null; copy: boolean; programmes: readonly ProgrammeOut[]; defaultYear: string; words: TodayWords; actions: FeePlanFormActions; go?: (href: string) => void;
}) {
  const router = useRouter();
  const nav = go ?? ((href: string) => router.push(href));
  const editing = plan !== null && !copy;
  const [name, setName] = React.useState(plan ? (copy ? `${plan.name}` : plan.name) : "");
  const [programmeId, setProgrammeId] = React.useState(plan?.programme_id ?? programmes.find((p) => p.active)?.id ?? "");
  const [groupId, setGroupId] = React.useState(plan?.group_id ?? "");
  const [year, setYear] = React.useState(plan?.academic_year ?? defaultYear);
  const [rows, setRows] = React.useState<LineDraft[]>(plan ? plan.lines.map((l) => ({ head: l.head, no: String(l.instalment_no), due: l.due_date, amount: paiseText(l.amount_paise) })) : [{ head: "tuition", no: "1", due: "", amount: "" }]);
  const [kind, setKind] = React.useState<"none" | "fixed" | "per_day">(plan?.late_fee_kind ?? "none");
  const [lateAmount, setLateAmount] = React.useState(paiseText(plan?.late_fee_paise ?? null));
  const [grace, setGrace] = React.useState(String(plan?.late_fee_grace_days ?? 0));
  const [cap, setCap] = React.useState(paiseText(plan?.late_fee_cap_paise ?? null));
  const [active, setActive] = React.useState(plan?.active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const programme = programmes.find((p) => p.id === programmeId) ?? null;
  const read = readLines(rows);
  const setRow = (i: number, patch: Partial<LineDraft>) => setRows((c) => c.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    if (busy) return;
    setProblem(null);
    if (name.trim() === "") return setProblem({ text: say(words, "edu.err.planname") });
    if (programmeId === "") return setProblem({ text: say(words, "edu.err.programme") });
    if (!isAcademicYear(year.trim())) return setProblem({ text: say(words, "edu.err.year") });
    if (!read.ok) return setProblem({ text: say(words, `edu.err.lines.${read.reason}`, { row: read.row }) });
    const late = readLate({ kind, amount: lateAmount, grace, cap });
    if (!late.ok) return setProblem({ text: say(words, `edu.err.late.${late.reason}`) });
    setBusy(true);
    const out = await actions.save(planId, { name: name.trim(), programmeId, groupId, academicYear: year.trim(), lateKind: late.kind, latePaise: late.paise, lateGraceDays: late.grace, lateCapPaise: late.cap, active, lines: read.lines });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    nav(`${base}/fees/plans/${out.planId}?saved=1`);
  }

  return (
    <form data-screen="fee-plan-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-3xl flex-col gap-5">
      {copy ? <p role="note" className={help}>{say(words, "edu.plan.copynote")}</p> : null}
      <div>
        <label htmlFor="fp-name" className={label}>{say(words, "edu.plan.name")}</label>
        <input id="fp-name" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-3">
        <div>
          <label htmlFor="fp-prog" className={label}>{say(words, "edu.sf.programme")}</label>
          <select id="fp-prog" value={programmeId} disabled={busy || editing} onChange={(e) => { setProgrammeId(e.target.value); setGroupId(""); }} className={field}>
            {programmes.filter((p) => p.active || p.id === plan?.programme_id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="fp-group" className={label}>{say(words, "edu.plan.group")}</label>
          <select id="fp-group" value={groupId} disabled={busy || editing || !programme || programme.groups.length === 0} onChange={(e) => setGroupId(e.target.value)} className={field}>
            <option value="">{say(words, "edu.plan.allgroups")}</option>
            {(programme?.groups ?? []).filter((g) => g.active).map((g) => (<option key={g.id} value={g.id}>{g.label}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="fp-year" className={label}>{say(words, "edu.plan.year")}</label>
          <input id="fp-year" value={year} maxLength={7} disabled={busy || editing} onChange={(e) => setYear(e.target.value)} aria-describedby="fp-year-h" className={field} />
          <p id="fp-year-h" className={help}>{say(words, "edu.plan.year.help")}</p>
        </div>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4" disabled={busy}>
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "edu.plan.lines")}</legend>
        <p className={help}>{say(words, "edu.plan.lines.help")}</p>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 min-[640px]:grid-cols-[1.2fr_5rem_1fr_1fr_auto]" data-line={i + 1}>
            <div>
              <label htmlFor={`fp-h${i}`} className={label}>{say(words, "edu.plan.head")}</label>
              <select id={`fp-h${i}`} value={r.head} onChange={(e) => setRow(i, { head: e.target.value as Head })} className={field}>
                {HEADS.map((h) => (<option key={h} value={h}>{say(words, `edu.head.${h}`)}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor={`fp-n${i}`} className={label}>{say(words, "edu.plan.no")}</label>
              <input id={`fp-n${i}`} inputMode="numeric" value={r.no} onChange={(e) => setRow(i, { no: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor={`fp-d${i}`} className={label}>{say(words, "edu.plan.due")}</label>
              <input id={`fp-d${i}`} type="date" value={r.due} onChange={(e) => setRow(i, { due: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor={`fp-a${i}`} className={label}>{say(words, "edu.plan.amount")}</label>
              <input id={`fp-a${i}`} inputMode="decimal" autoComplete="off" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} className={field} />
            </div>
            <button type="button" className={quiet} onClick={() => setRows((c) => c.filter((_, j) => j !== i))} aria-label={say(words, "edu.plan.remove", { n: i + 1 })}>×</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className={secondary} onClick={() => setRows((c) => [...c, { head: c[c.length - 1]?.head ?? "tuition", no: String((Number(c[c.length - 1]?.no) || 0) + 1), due: "", amount: "" }])}>{say(words, "edu.plan.addrow")}</button>
          <p className="font-display text-lg font-bold tabular-nums" data-part="total">{say(words, "edu.plan.total")}: {read.ok ? formatRupees(read.total) : "—"}</p>
        </div>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4" disabled={busy}>
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "edu.plan.late")}</legend>
        <p className={help}>{say(words, "edu.plan.late.help")}</p>
        <div role="radiogroup" aria-label={say(words, "edu.plan.late")} className="flex flex-col gap-1">
          {(["none", "fixed", "per_day"] as const).map((k) => (
            <label key={k} className="flex min-h-11 items-center gap-3 text-base">
              <input type="radio" name="late" className="size-5 shrink-0 accent-brand-text" checked={kind === k} onChange={() => setKind(k)} />
              {say(words, `edu.plan.late.${k}`)}
            </label>
          ))}
        </div>
        {kind !== "none" ? (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-3">
            <div>
              <label htmlFor="fp-la" className={label}>{say(words, kind === "fixed" ? "edu.plan.late.amount.fixed" : "edu.plan.late.amount.day")}</label>
              <input id="fp-la" inputMode="decimal" value={lateAmount} onChange={(e) => setLateAmount(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="fp-lg" className={label}>{say(words, "edu.plan.late.grace")}</label>
              <input id="fp-lg" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} className={field} />
            </div>
            {kind === "per_day" ? (
              <div>
                <label htmlFor="fp-lc" className={label}>{say(words, "edu.plan.late.cap")}</label>
                <input id="fp-lc" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={field} />
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      {editing ? (
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" className="size-5 accent-brand-text" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />
          {say(words, "edu.plan.active")}
        </label>
      ) : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primary} disabled={busy}>{busy ? say(words, "today.act.working") : say(words, editing ? "edu.plan.save.edit" : "edu.plan.save.new")}</button>
        <Link href={`${base}/fees/plans`} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
