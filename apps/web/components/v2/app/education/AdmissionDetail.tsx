"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AdmissionDetailOut, FeePlanOut, ProgrammeOut } from "@contracts/education";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { backLink } from "../ui";
import { card, errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";
import { labelProblem } from "./StudentForm";

type Refused = { ok: false; error: string; mfa?: boolean };
export type AdmitFormInput = { studentId: string; isAdult: boolean; childLabel: string; programmeId: string; groupId: string; admissionNo: string; planId: string; assignmentId: string; joinedOn: string };
export type AdmissionActions = {
  stage: (stage: "enquiry" | "campus_visit" | "application" | "lost", lostReason: string | null) => Promise<{ ok: true } | Refused>;
  admit: (input: AdmitFormInput) => Promise<{ ok: true; studentId: string } | Refused>;
};

const LOST = ["fees", "distance", "other_school", "not_interested", "no_response", "other"] as const;
const NEXT: Record<string, readonly ("campus_visit" | "application")[]> = { enquiry: ["campus_visit", "application"], campus_visit: ["application"], application: [], admitted: [], lost: [] };

/**
 * One admission enquiry (job CS): the adult, the class asked about, where it came from, the campus visits and every stage reached with its day. An enquiry moves FORWARD only (enquiry, campus visit, application); it can be lost from any
 * open stage with a reason, and an Owner or Admin can re-open a lost one. Admitting (the Owner or an Admin) makes the student, a first name or initials and a placement, and may give a fee plan, all in one go: if anything is wrong nothing is
 * made. A campus visit is booked on the visits page for this enquiry's lead.
 */
export function AdmissionDetail({ admission, base, role, words, programmes, plans, saved, today, actions }: {
  admission: AdmissionDetailOut; base: string; role: Role; words: TodayWords; programmes: readonly ProgrammeOut[]; plans: readonly FeePlanOut[]; saved: boolean; today: string; actions: AdmissionActions;
}) {
  const router = useRouter();
  const writer = role === "owner" || role === "admin";
  const [ask, setAsk] = React.useState<null | "lost" | "admit" | "reopen">(null);
  const [reason, setReason] = React.useState<string>("fees");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [af, setAf] = React.useState<AdmitFormInput>({ studentId: "", isAdult: false, childLabel: "", programmeId: admission.programme_id ?? "", groupId: "", admissionNo: "", planId: "", assignmentId: "", joinedOn: today });
  const programme = programmes.find((p) => p.id === af.programmeId) ?? null;
  const planChoices = plans.filter((p) => p.active && p.programme_id === af.programmeId && (p.group_id === null || p.group_id === af.groupId));
  const open = admission.stage === "enquiry" || admission.stage === "campus_visit" || admission.stage === "application";

  async function move(stage: "enquiry" | "campus_visit" | "application" | "lost", lost: string | null) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const out = await actions.stage(stage, lost);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setAsk(null);
    router.refresh();
  }
  async function admit() {
    if (busy) return;
    setProblem(null);
    if (!af.isAdult) {
      const p = labelProblem(af.childLabel);
      if (p) return setProblem({ text: say(words, `edu.err.label.${p}`) });
    }
    if (af.programmeId === "") return setProblem({ text: say(words, "edu.err.programme") });
    setBusy(true);
    const out = await actions.admit({ ...af, planId: af.planId, assignmentId: af.planId === "" ? "" : af.assignmentId });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setAsk(null);
    router.push(`${base}/students/${out.studentId}?saved=1`);
  }
  const openAdmit = () => {
    setProblem(null);
    setAf((c) => ({ ...c, studentId: crypto.randomUUID(), assignmentId: crypto.randomUUID(), planId: "" }));
    setAsk("admit");
  };

  return (
    <div data-screen="admission" className="flex flex-col gap-5">
      <p><Link href={`${base}/admissions`} className={backLink}>{say(words, "edu.adm.back")}</Link></p>
      {saved ? <p role="status" className={okLine}>{say(words, "edu.adm.saved")}</p> : null}
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl md:leading-[1.1]">{admission.contact_name ?? say(words, "edu.adm.unknown")}</h1>
        <p className="flex flex-wrap items-center gap-2 text-base text-muted">
          <Pill tone={admission.stage === "admitted" ? "green" : admission.stage === "lost" ? "neutral" : "info"}>{say(words, `edu.stage.${admission.stage}`)}</Pill>
          <span>{[admission.programme_name, say(words, `edu.source.${admission.source}`)].filter(Boolean).join(" · ")}</span>
        </p>
      </header>
      <section className={card} aria-labelledby="ad-hist">
        <h2 id="ad-hist" className="font-display text-lg font-bold">{say(words, "edu.adm.history")}</h2>
        <ol className="flex flex-col gap-1.5 text-base" data-part="history">
          {admission.events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{say(words, `edu.stage.${e.stage}`)}{e.lost_reason ? ` · ${say(words, `edu.lost.${e.lost_reason}`)}` : ""}</span>
              <span className="text-sm text-muted tabular-nums">{e.at.slice(0, 10)}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">{say(words, "edu.adm.visits", { n: admission.visits })}{admission.next_visit ? ` · ${say(words, "edu.adm.nextvisit", { date: admission.next_visit.slice(0, 10) })}` : ""}</p>
      </section>
      <section className={card} aria-labelledby="ad-act" data-part="actions">
        <h2 id="ad-act" className="font-display text-lg font-bold">{say(words, "edu.adm.next")}</h2>
        <div className="flex flex-wrap gap-2">
          {open ? <Link href={`${base}/visits?lead=${admission.lead_id}`} className={secondary}>{say(words, "edu.adm.book")}</Link> : null}
          {NEXT[admission.stage].map((st) => (<button key={st} type="button" className={secondary} disabled={busy} onClick={() => void move(st, null)}>{say(words, `edu.adm.move.${st}`)}</button>))}
          {admission.stage === "application" && writer ? <button type="button" className={primary} onClick={openAdmit}>{say(words, "edu.adm.admit")}</button> : null}
          {open ? <button type="button" className={secondary} onClick={() => { setProblem(null); setAsk("lost"); }}>{say(words, "edu.adm.lost")}</button> : null}
          {admission.stage === "lost" && writer ? <button type="button" className={secondary} onClick={() => { setProblem(null); setAsk("reopen"); }}>{say(words, "edu.adm.reopen")}</button> : null}
          {admission.stage === "admitted" && admission.student_id ? <Link href={`${base}/students/${admission.student_id}`} className={primary}>{say(words, "edu.adm.openstudent")}</Link> : null}
        </div>
        {admission.stage === "application" && !writer ? <p className={help}>{say(words, "edu.adm.admit.owner")}</p> : null}
        {problem && ask === null ? <p role="alert" className={errorLine}>{problem.text}</p> : null}
      </section>

      <Sheet open={ask === "lost"} onClose={() => !busy && setAsk(null)} busy={busy} id="admission-lost" title={say(words, "edu.adm.lost.title")} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor="al-reason" className={label}>{say(words, "edu.adm.lost.reason")}</label>
          <select id="al-reason" data-autofocus value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} className={field}>
            {LOST.map((r) => (<option key={r} value={r}>{say(words, `edu.lost.${r}`)}</option>))}
          </select>
        </div>
        {problem ? <p role="alert" className={errorLine}>{problem.text}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void move("lost", reason)}>{busy ? say(words, "today.act.working") : say(words, "edu.adm.lost.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
      <Sheet open={ask === "reopen"} onClose={() => !busy && setAsk(null)} busy={busy} id="admission-reopen" title={say(words, "edu.adm.reopen.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "edu.adm.reopen.body")}</p>
        {problem ? <p role="alert" className={errorLine}>{problem.text}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void move("enquiry", null)}>{busy ? say(words, "today.act.working") : say(words, "edu.adm.reopen")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
      <Sheet open={ask === "admit"} onClose={() => !busy && setAsk(null)} busy={busy} id="admission-admit" title={say(words, "edu.adm.admit.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "edu.adm.admit.body")}</p>
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" className="size-5 shrink-0 accent-brand-text" checked={af.isAdult} disabled={busy} onChange={(e) => setAf({ ...af, isAdult: e.target.checked })} />
          {say(words, "edu.sf.adult")}
        </label>
        {!af.isAdult ? (
          <div>
            <label htmlFor="am-label" className={label}>{say(words, "edu.sf.label")}</label>
            <input id="am-label" data-autofocus value={af.childLabel} maxLength={30} autoComplete="off" disabled={busy} onChange={(e) => setAf({ ...af, childLabel: e.target.value })} aria-describedby="am-label-h" className={field} />
            <p id="am-label-h" className={help}>{say(words, "edu.sf.label.help")}</p>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="am-prog" className={label}>{say(words, "edu.sf.programme")}</label>
            <select id="am-prog" value={af.programmeId} disabled={busy} onChange={(e) => setAf({ ...af, programmeId: e.target.value, groupId: "", planId: "" })} className={field}>
              <option value="">{say(words, "edu.sf.choose")}</option>
              {programmes.filter((p) => p.active).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </div>
          {programme && programme.group_kind !== "none" ? (
            <div>
              <label htmlFor="am-group" className={label}>{say(words, `edu.divided.${programme.group_kind}`)}</label>
              <select id="am-group" value={af.groupId} disabled={busy} onChange={(e) => setAf({ ...af, groupId: e.target.value, planId: "" })} className={field}>
                <option value="">{say(words, "edu.sf.choose")}</option>
                {programme.groups.filter((g) => g.active).map((g) => (<option key={g.id} value={g.id}>{g.label}</option>))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="am-no" className={label}>{say(words, "edu.sf.admno")}</label>
            <input id="am-no" value={af.admissionNo} maxLength={30} disabled={busy} onChange={(e) => setAf({ ...af, admissionNo: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="am-joined" className={label}>{say(words, "edu.sf.joined")}</label>
            <input id="am-joined" type="date" value={af.joinedOn} disabled={busy} onChange={(e) => setAf({ ...af, joinedOn: e.target.value })} className={field} />
          </div>
        </div>
        {planChoices.length > 0 ? (
          <div>
            <label htmlFor="am-plan" className={label}>{say(words, "edu.adm.plan")}</label>
            <select id="am-plan" value={af.planId} disabled={busy} onChange={(e) => setAf({ ...af, planId: e.target.value })} className={field}>
              <option value="">{say(words, "edu.adm.plan.none")}</option>
              {planChoices.map((p) => (<option key={p.id} value={p.id}>{p.name} · {p.academic_year}</option>))}
            </select>
          </div>
        ) : null}
        <p className={help}>{say(words, "edu.sf.minimum")}</p>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void admit()}>{busy ? say(words, "today.act.working") : say(words, "edu.adm.admit.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setAsk(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
