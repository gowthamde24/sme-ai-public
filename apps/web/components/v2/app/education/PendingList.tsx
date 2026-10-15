import Link from "next/link";

import type { PendingRowOut, ProgrammeOut } from "@contracts/education";

import { formatRupees } from "@/lib/money";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { backLink } from "../ui";
import { card, field, label, quiet, secondary } from "../visits/styles";

/**
 * Who has fees pending (job CS): money that has FALLEN DUE and is not yet paid or conceded, the largest first. The word is "pending", never anything harsher. A row is the student's first name, class and section, the guardian, how much
 * is pending, how much has fallen due and how many days since the oldest instalment. The page pages by the largest amount. A row opens the student's account. Owner, Admin and Sales read.
 */
export function PendingList({ base, words, rows, programmes, programme, more }: { base: string; words: TodayWords; rows: readonly PendingRowOut[] | null; programmes: readonly ProgrammeOut[]; programme: string | null; more: string | null }) {
  return (
    <div data-screen="fees-pending" className="flex flex-col gap-5">
      <p><Link href={`${base}/fees`} className={backLink}>{say(words, "edu.fees.back")}</Link></p>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "edu.pending.title")}</h1>
        <p className="text-base text-muted">{say(words, "edu.pending.sub")}</p>
      </header>
      <form method="get" action={`${base}/fees/pending`} className="flex flex-wrap items-end gap-3" aria-label={say(words, "edu.stu.filters")}>
        <div className="min-w-40">
          <label htmlFor="pl-prog" className={label}>{say(words, "edu.stu.programme")}</label>
          <select id="pl-prog" name="programme" defaultValue={programme ?? ""} className={field}>
            <option value="">{say(words, "edu.stu.all")}</option>
            {programmes.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <button type="submit" className={secondary}>{say(words, "edu.stu.filter")}</button>
        {programme ? <Link href={`${base}/fees/pending`} className={quiet}>{say(words, "edu.stu.clear")}</Link> : null}
      </form>
      {rows === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "edu.loaderr")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line p-4 text-base text-muted" data-part="empty">{say(words, "edu.pending.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.student_id}>
              <Link href={`${base}/fees/students/${r.student_id}`} className={`${card} min-h-11 hover:bg-surface-2`} data-pending={r.student_id}>
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-display text-lg font-bold [overflow-wrap:anywhere]">{r.display_name ?? say(words, "edu.stu.erased")}</span>
                  <span className="font-display text-xl font-bold tabular-nums">{formatRupees(r.pending_paise)}</span>
                </span>
                <span className="text-sm text-muted">{[r.programme_name, r.group_label].filter(Boolean).join(" · ")}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {r.contact_name ? <span>{say(words, "edu.stu.guardian", { name: r.contact_name })}</span> : null}
                  <span>{say(words, "edu.pending.due", { amount: formatRupees(r.due_paise) })}</span>
                  {r.overdue_days > 0 ? <Pill tone="amber">{say(words, "due.days.late", { n: r.overdue_days })}</Pill> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more ? <p><Link href={more} className={quiet}>{say(words, "mat.products.more")}</Link></p> : null}
    </div>
  );
}
