"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { GuardianFeesOut, StudentOut } from "@contracts/education";

import { formatRupees } from "@/lib/money";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, danger, errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
export type StudentDetailActions = {
  setStatus: (status: "active" | "left", leftOn: string | null) => Promise<{ ok: true } | Refused>;
  erase: () => Promise<{ ok: true } | Refused>;
};

/**
 * One student (job CS): the minimum record, where they sit, the adult we write to, and, when the school keeps fees, what the guardian owes across their children (one total, never one child's name in a message). Owner and Admin
 * mark a student as having left (the retention clock starts that day) or back, and the Owner alone, with the authenticator code, erases the child on request: the name and number go, the row and the money records stay. Sales read.
 */
export function StudentDetail({ student, base, role, words, guardianFees, today, saved, actions }: { student: StudentOut; base: string; role: Role; words: TodayWords; guardianFees: GuardianFeesOut | null; today: string; saved: boolean; actions: StudentDetailActions }) {
  const router = useRouter();
  const writer = role === "owner" || role === "admin";
  const [ask, setAsk] = React.useState<null | "left" | "active" | "erase">(null);
  const [leftOn, setLeftOn] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);

  async function go() {
    if (busy || !ask) return;
    setBusy(true);
    setProblem(null);
    const out = ask === "erase" ? await actions.erase() : await actions.setStatus(ask, ask === "left" ? leftOn : null);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setAsk(null);
    router.refresh();
  }
  const name = student.erased ? say(words, "edu.stu.erased") : (student.display_name ?? student.contact_name ?? "");

  return (
    <div data-screen="student" className="flex flex-col gap-5">
      <p><Link href={`${base}/students`} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">{say(words, "edu.back")}</Link></p>
      {saved ? <p role="status" className={okLine}>{say(words, "edu.stu.saved")}</p> : null}
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl md:leading-[1.1]">{name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-base text-muted">
          {student.is_adult ? <Pill tone="info">{say(words, "edu.stu.adult")}</Pill> : null}
          <Pill tone={student.status === "active" ? "green" : "neutral"}>{say(words, `edu.status.${student.status}`)}</Pill>
          {student.erased ? <Pill tone="amber">{say(words, "edu.stu.erased")}</Pill> : null}
        </p>
      </header>
      <section className={card} aria-labelledby="sd-h">
        <h2 id="sd-h" className="font-display text-lg font-bold">{say(words, "edu.sd.record")}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-base min-[480px]:grid-cols-2">
          <div><dt className="text-sm text-muted">{say(words, "edu.sf.programme")}</dt><dd className="font-semibold">{student.programme_name ?? ""}</dd></div>
          {student.group_label ? <div><dt className="text-sm text-muted">{say(words, "edu.sd.group")}</dt><dd className="font-semibold">{student.group_label}</dd></div> : null}
          {student.admission_no ? <div><dt className="text-sm text-muted">{say(words, "edu.sf.admno")}</dt><dd className="font-semibold">{student.admission_no}</dd></div> : null}
          {student.joined_on ? <div><dt className="text-sm text-muted">{say(words, "edu.sf.joined")}</dt><dd className="font-semibold">{student.joined_on}</dd></div> : null}
          {student.left_on ? <div><dt className="text-sm text-muted">{say(words, "edu.sd.leftOn")}</dt><dd className="font-semibold">{student.left_on}</dd></div> : null}
          {!student.is_adult && student.contact_name ? <div><dt className="text-sm text-muted">{say(words, "edu.sf.guardian")}</dt><dd className="font-semibold [overflow-wrap:anywhere]">{student.contact_name}</dd></div> : null}
        </dl>
        <p className={help}>{say(words, "edu.sf.minimum")}</p>
        <div className="flex flex-wrap gap-2">
          {writer && !student.erased ? <Link href={`${base}/students/${student.id}/edit`} className={secondary}>{say(words, "edu.edit")}</Link> : null}
          {writer && !student.erased && student.status === "active" ? <button type="button" className={secondary} onClick={() => { setProblem(null); setAsk("left"); }}>{say(words, "edu.sd.markleft")}</button> : null}
          {writer && !student.erased && student.status === "left" ? <button type="button" className={secondary} onClick={() => { setProblem(null); setAsk("active"); }}>{say(words, "edu.sd.markback")}</button> : null}
          {writer && !student.erased && !student.is_adult ? <Link href={`${base}/students/new?contact=${student.contact_id}`} className={secondary}>{say(words, "edu.sd.sibling")}</Link> : null}
        </div>
      </section>
      {guardianFees ? (
        <section className={card} aria-labelledby="sd-fees" data-part="fees">
          <h2 id="sd-fees" className="font-display text-lg font-bold">{say(words, "edu.sd.fees")}</h2>
          <ul className="flex flex-col gap-1 text-base">
            {guardianFees.students.map((s) => (
              <li key={s.student_id} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`${base}/fees/students/${s.student_id}`} className="font-semibold text-brand-text underline">{s.display_name ?? say(words, "edu.stu.erased")}</Link>
                <span className="tabular-nums">{formatRupees(s.outstanding_paise)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between gap-2 border-t border-line pt-2 text-base font-semibold"><span>{say(words, "edu.sd.total")}</span><span className="tabular-nums">{formatRupees(guardianFees.outstanding_paise)}</span></p>
          <Link href={`${base}/fees/students/${student.id}`} className={primary}>{say(words, "edu.sd.openfees")}</Link>
        </section>
      ) : null}
      {role === "owner" && !student.erased ? (
        <section className={card} aria-labelledby="sd-erase">
          <h2 id="sd-erase" className="font-display text-lg font-bold">{say(words, "edu.sd.erase.title")}</h2>
          <p className={help}>{say(words, "edu.sd.erase.help")}</p>
          <div><button type="button" className={danger} onClick={() => { setProblem(null); setAsk("erase"); }}>{say(words, "edu.sd.erase")}</button></div>
        </section>
      ) : null}
      <Sheet open={ask !== null} onClose={() => !busy && setAsk(null)} busy={busy} id="student-state" title={ask ? say(words, `edu.sd.${ask}.title`) : ""} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{ask ? say(words, `edu.sd.${ask}.body`) : ""}</p>
        {ask === "left" ? (
          <div>
            <label htmlFor="sd-left" className={label}>{say(words, "edu.sd.leftOn")}</label>
            <input id="sd-left" type="date" data-autofocus max={today} value={leftOn} disabled={busy} onChange={(e) => setLeftOn(e.target.value)} className={field} />
          </div>
        ) : null}
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={ask === "erase" ? danger : primary} disabled={busy || (ask === "left" && leftOn === "")} onClick={() => void go()}>{busy ? say(words, "today.act.working") : ask ? say(words, `edu.sd.${ask}.go`) : ""}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
