import Link from "next/link";

import type { AdmissionOut, ProgrammeOut } from "@contracts/education";

import { AgentMark } from "../mark/AgentMark";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { field, label, okLine, primary, quiet, secondary } from "../visits/styles";

export const STAGE_ORDER = ["enquiry", "campus_visit", "application", "admitted", "lost"] as const;

/**
 * The admissions board (job CS): every enquiry in the column of the stage it has reached (enquiry, campus visit, application, admitted, lost), the newest first. On a phone the columns stack, one under the other, each with its count.
 * A card is the guardian's name, the class asked about, where the enquiry came from and the next campus visit. A child who has not been admitted is not stored: the board has only the adult we write to. Owner, Admin and Sales read
 * and add enquiries and move them; the Owner and Admin admit.
 */
export function AdmissionsBoard({ base, words, role, admissions, programmes, programme, source, more, saved }: { base: string; words: TodayWords; role: Role; admissions: readonly AdmissionOut[] | null; programmes: readonly ProgrammeOut[]; programme: string | null; source: string | null; more: boolean; saved: boolean }) {
  const byStage = (s: string) => (admissions ?? []).filter((a) => a.stage === s);
  const filtered = programme !== null || source !== null;
  return (
    <div data-screen="admissions" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.admissions")}</h1>
          <p className="text-base text-muted">{say(words, "edu.adm.sub")}</p>
        </div>
        {role !== "viewer" ? <Link href={`${base}/admissions/new`} className={primary}>{say(words, "edu.adm.add")}</Link> : null}
      </header>
      {saved ? <p role="status" className={okLine}>{say(words, "edu.adm.saved")}</p> : null}
      <form method="get" action={`${base}/admissions`} className="flex flex-wrap items-end gap-3" aria-label={say(words, "edu.stu.filters")}>
        <div className="min-w-40">
          <label htmlFor="af-prog" className={label}>{say(words, "edu.stu.programme")}</label>
          <select id="af-prog" name="programme" defaultValue={programme ?? ""} className={field}>
            <option value="">{say(words, "edu.stu.all")}</option>
            {programmes.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <div className="min-w-40">
          <label htmlFor="af-src" className={label}>{say(words, "edu.adm.source")}</label>
          <select id="af-src" name="source" defaultValue={source ?? ""} className={field}>
            <option value="">{say(words, "edu.stu.all")}</option>
            {(["whatsapp", "walk_in", "website", "ad", "referral", "other"] as const).map((s) => (<option key={s} value={s}>{say(words, `edu.source.${s}`)}</option>))}
          </select>
        </div>
        <button type="submit" className={secondary}>{say(words, "edu.stu.filter")}</button>
        {filtered ? <Link href={`${base}/admissions`} className={quiet}>{say(words, "edu.stu.clear")}</Link> : null}
      </form>
      {admissions === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "edu.loaderr")}</p>
      ) : admissions.length === 0 ? (
        <div className="flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5" data-part="empty">
          <AgentMark px={72} agent="main" className="size-[72px]" />
          <div className="min-w-0">
            <p className="font-semibold">{say(words, filtered ? "edu.stu.none.filtered" : "edu.adm.none.title")}</p>
            {!filtered ? <p className="text-base text-muted">{say(words, "edu.adm.none.body")}</p> : null}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          {STAGE_ORDER.map((stage) => {
            const cards = byStage(stage);
            return (
              <section key={stage} aria-labelledby={`col-${stage}`} data-stage={stage} className="flex min-w-0 flex-col gap-2">
                <h2 id={`col-${stage}`} className="flex items-baseline justify-between gap-2 border-b border-line pb-1 font-display text-lg font-bold"><span>{say(words, `edu.stage.${stage}`)}</span><span className="text-base font-semibold tabular-nums text-muted">{cards.length}</span></h2>
                {cards.length === 0 ? <p className="text-sm text-muted">{say(words, "edu.adm.col.empty")}</p> : (
                  <ul className="flex flex-col gap-2">
                    {cards.map((a) => (
                      <li key={a.id}>
                        <Link href={`${base}/admissions/${a.id}`} className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line bg-surface p-3 hover:bg-surface-2" data-admission={a.id}>
                          <span className="font-semibold [overflow-wrap:anywhere]">{a.contact_name ?? say(words, "edu.adm.unknown")}</span>
                          <span className="text-sm text-muted">{[a.programme_name, say(words, `edu.source.${a.source}`)].filter(Boolean).join(" · ")}</span>
                          {a.next_visit ? <Pill tone="info">{say(words, "edu.adm.nextvisit", { date: a.next_visit.slice(0, 10) })}</Pill> : null}
                          {a.stage === "lost" && a.lost_reason ? <span className="text-sm text-muted">{say(words, `edu.lost.${a.lost_reason}`)}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {more ? <p className="text-sm text-muted">{say(words, "edu.adm.more")}</p> : null}
    </div>
  );
}
