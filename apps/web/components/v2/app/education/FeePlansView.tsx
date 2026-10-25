import Link from "next/link";

import type { FeePlanDetailOut, FeePlanOut, ProgrammeOut } from "@contracts/education";

import { formatRupees } from "@/lib/money";

import { OrbMark } from "../mark/OrbMark";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { backLink } from "../ui";
import { card, help, okLine, primary, secondary } from "../visits/styles";

/** The fee plans of the school (job CS), newest first: the name, the class (and section), the academic year, the total of the instalments and how many students hold the plan. Owner and Admin make plans; Sales read. */
export function FeePlansView({ base, words, role, plans, programmes }: { base: string; words: TodayWords; role: Role; plans: readonly FeePlanOut[] | null; programmes: readonly ProgrammeOut[] }) {
  const writer = role === "owner" || role === "admin";
  const nameOf = (id: string) => programmes.find((p) => p.id === id);
  return (
    <div data-screen="fee-plans" className="flex flex-col gap-5">
      <p><Link href={`${base}/fees`} className={backLink}>{say(words, "edu.fees.back")}</Link></p>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "edu.fees.plans")}</h1>
          <p className="text-base text-muted">{say(words, "edu.plans.sub")}</p>
        </div>
        {writer && plans !== null && plans.length > 0 ? <Link href={`${base}/fees/plans/new`} className={primary}>{say(words, "edu.plan.add")}</Link> : null}
      </header>
      {plans === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "edu.loaderr")}</p>
      ) : plans.length === 0 ? (
        <div className="flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5" data-part="empty">
          <OrbMark px={72} className="size-[72px]" />
          <div className="min-w-0">
            <p className="font-semibold">{say(words, "edu.plans.none.title")}</p>
            <p className="text-base text-muted">{say(words, "edu.plans.none.body")}</p>
            {writer ? <p className="mt-3"><Link href={`${base}/fees/plans/new`} className={primary}>{say(words, "edu.plan.add")}</Link></p> : null}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/fees/plans/${p.id}`} className={`${card} min-h-11 hover:bg-surface-2`} data-plan={p.id}>
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-display text-lg font-bold [overflow-wrap:anywhere]">{p.name}</span>
                  <span className="flex flex-wrap gap-1.5">{!p.active ? <Pill tone="neutral">{say(words, "edu.inactive")}</Pill> : null}<Pill tone="info">{p.academic_year}</Pill></span>
                </span>
                <span className="text-sm text-muted">
                  {[nameOf(p.programme_id)?.name, p.group_id ? nameOf(p.programme_id)?.groups.find((g) => g.id === p.group_id)?.label : null, say(words, "edu.plan.holders", { n: p.assigned })].filter(Boolean).join(" · ")}
                </span>
                <span className="font-display text-xl font-bold tabular-nums">{formatRupees(p.total_paise)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One fee plan, read only (job CS): its instalments by head and date, the late-fee rule and who holds it. A plan someone holds cannot change; "make a copy" opens the form with the same lines. */
export function FeePlanDetail({ base, words, role, plan, programme, saved }: { base: string; words: TodayWords; role: Role; plan: FeePlanDetailOut; programme: ProgrammeOut | null; saved: boolean }) {
  const writer = role === "owner" || role === "admin";
  const byDue = [...plan.lines].sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.head.localeCompare(b.head)));
  return (
    <div data-screen="fee-plan" className="flex flex-col gap-5">
      <p><Link href={`${base}/fees/plans`} className={backLink}>{say(words, "edu.plan.back")}</Link></p>
      {saved ? <p role="status" className={okLine}>{say(words, "edu.plan.saved")}</p> : null}
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl md:leading-[1.1]">{plan.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-base text-muted">
          <Pill tone="info">{plan.academic_year}</Pill>
          <span>{[programme?.name, plan.group_id ? programme?.groups.find((g) => g.id === plan.group_id)?.label : null, say(words, "edu.plan.holders", { n: plan.assigned })].filter(Boolean).join(" · ")}</span>
          {!plan.active ? <Pill tone="neutral">{say(words, "edu.inactive")}</Pill> : null}
        </p>
      </header>
      <section className={card} aria-labelledby="fpd-lines">
        <h2 id="fpd-lines" className="font-display text-lg font-bold">{say(words, "edu.plan.lines")}</h2>
        <ul className="flex flex-col gap-1.5">
          {byDue.map((l) => (
            <li key={`${l.head}:${l.instalment_no}`} className="flex flex-wrap items-baseline justify-between gap-2 text-base" data-line={`${l.head}:${l.instalment_no}`}>
              <span><span className="font-semibold">{say(words, `edu.head.${l.head}`)} {l.instalment_no}</span> <span className="text-sm text-muted">{say(words, "due.due.on", { date: l.due_date })}</span></span>
              <span className="tabular-nums">{formatRupees(l.amount_paise)}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-baseline justify-between gap-2 border-t border-line pt-2 text-lg font-bold"><span>{say(words, "edu.plan.total")}</span><span className="tabular-nums" data-part="total">{formatRupees(plan.total_paise)}</span></p>
      </section>
      <section className={card} aria-labelledby="fpd-late">
        <h2 id="fpd-late" className="font-display text-lg font-bold">{say(words, "edu.plan.late")}</h2>
        {plan.late_fee_kind === "none" ? (
          <p className="text-base text-muted">{say(words, "edu.plan.late.none")}</p>
        ) : (
          <p className="text-base">
            {say(words, plan.late_fee_kind === "fixed" ? "edu.plan.late.fixed.line" : "edu.plan.late.day.line", { amount: formatRupees(plan.late_fee_paise ?? 0), days: plan.late_fee_grace_days })}
            {plan.late_fee_cap_paise !== null ? ` ${say(words, "edu.plan.late.cap.line", { amount: formatRupees(plan.late_fee_cap_paise) })}` : ""}
          </p>
        )}
      </section>
      {writer ? (
        <div className="flex flex-wrap gap-2">
          {plan.assigned === 0 ? <Link href={`${base}/fees/plans/${plan.id}/edit`} className={secondary}>{say(words, "edu.edit")}</Link> : <p className={help}>{say(words, "edu.plan.locked")}</p>}
          <Link href={`${base}/fees/plans/new?from=${plan.id}`} className={primary}>{say(words, "edu.plan.copy")}</Link>
        </div>
      ) : null}
    </div>
  );
}
