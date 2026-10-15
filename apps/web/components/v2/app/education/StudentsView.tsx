import Link from "next/link";

import type { ProgrammeOut, StudentOut } from "@contracts/education";

import { PlushStill } from "../owl/PlushStill";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, field, label, okLine, primary, quiet, secondary } from "../visits/styles";

/**
 * The students of the school (job CS): the minimum record, nothing more. A row is the first name or initials, the class and section, the admission number, the adult we write to and whether the student is still here. Filters are
 * plain links and a form that works without scripts. Owner, Admin and Sales read; Owner and Admin add and change. A Viewer never reaches this page. An erased student shows as "erased" with no name.
 */
export function StudentsView({ base, words, role, students, programmes, programme, status, more, saved, imported }: {
  base: string; words: TodayWords; role: Role; students: readonly StudentOut[] | null; programmes: readonly ProgrammeOut[]; programme: string | null; status: "active" | "left" | null; more: string | null; saved: boolean; imported: boolean;
}) {
  const writer = role === "owner" || role === "admin";
  const filtered = programme !== null || status !== null;
  return (
    <div data-screen="students" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.students")}</h1>
          <p className="text-base text-muted">{say(words, "edu.stu.sub")}</p>
        </div>
        {writer ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/students/import`} className={secondary}>{say(words, "edu.stu.import")}</Link>
            <Link href={`${base}/students/new`} className={primary}>{say(words, "edu.stu.add")}</Link>
          </div>
        ) : null}
      </header>
      {saved ? <p role="status" className={okLine}>{say(words, "edu.stu.saved")}</p> : null}
      {imported ? <p role="status" className={okLine}>{say(words, "edu.stu.imported")}</p> : null}
      <form method="get" action={`${base}/students`} className="flex flex-wrap items-end gap-3" aria-label={say(words, "edu.stu.filters")}>
        <div className="min-w-40">
          <label htmlFor="sf-prog" className={label}>{say(words, "edu.stu.programme")}</label>
          <select id="sf-prog" name="programme" defaultValue={programme ?? ""} className={field}>
            <option value="">{say(words, "edu.stu.all")}</option>
            {programmes.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <div className="min-w-40">
          <label htmlFor="sf-status" className={label}>{say(words, "edu.stu.status")}</label>
          <select id="sf-status" name="status" defaultValue={status ?? ""} className={field}>
            <option value="">{say(words, "edu.stu.all")}</option>
            <option value="active">{say(words, "edu.status.active")}</option>
            <option value="left">{say(words, "edu.status.left")}</option>
          </select>
        </div>
        <button type="submit" className={secondary}>{say(words, "edu.stu.filter")}</button>
        {filtered ? <Link href={`${base}/students`} className={quiet}>{say(words, "edu.stu.clear")}</Link> : null}
      </form>
      {students === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "edu.loaderr")}</p>
      ) : students.length === 0 ? (
        <div className="flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5" data-part="empty">
          <PlushStill px={72} agent="main" className="size-[72px]" />
          <div className="min-w-0">
            <p className="font-semibold">{say(words, filtered ? "edu.stu.none.filtered" : "edu.stu.none.title")}</p>
            {!filtered ? <p className="text-base text-muted">{say(words, "edu.stu.none.body")}</p> : null}
            {!filtered && writer ? <p className="mt-3"><Link href={`${base}/students/import`} className={primary}>{say(words, "edu.stu.import")}</Link></p> : null}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {students.map((s) => (
            <li key={s.id}>
              <Link href={`${base}/students/${s.id}`} className={`${card} min-h-11 hover:bg-surface-2`} data-student={s.id}>
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 font-display text-lg font-bold [overflow-wrap:anywhere]">{s.erased ? say(words, "edu.stu.erased") : (s.display_name ?? s.contact_name ?? "")}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {s.is_adult ? <Pill tone="info">{say(words, "edu.stu.adult")}</Pill> : null}
                    {s.status === "left" ? <Pill tone="neutral">{say(words, "edu.status.left")}</Pill> : null}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  {[s.programme_name, s.group_label, s.admission_no ? say(words, "edu.stu.admno", { no: s.admission_no }) : null].filter(Boolean).join(" · ")}
                </span>
                {!s.is_adult && s.contact_name ? <span className="text-sm text-muted">{say(words, "edu.stu.guardian", { name: s.contact_name })}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more ? <p><Link href={more} className={quiet}>{say(words, "mat.products.more")}</Link></p> : null}
    </div>
  );
}
