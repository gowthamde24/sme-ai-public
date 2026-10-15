"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { ProgrammeOut, StudentOut } from "@contracts/education";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
export type StudentFormInput = { contactId: string; isAdult: boolean; childLabel: string; programmeId: string; groupId: string; admissionNo: string; joinedOn: string };
export type StudentFormActions = { save: (studentId: string, input: StudentFormInput) => Promise<{ ok: true; studentId: string } | Refused> };
export type GuardianChoice = { id: string; name: string };

const NOT_A_NAME = /[0-9@]/;

/** The label rule the API and the database enforce, said before the request: a first name or initials, up to 30 characters, no digits and no e-mail address. */
export function labelProblem(text: string): "empty" | "long" | "chars" | null {
  const v = text.trim();
  if (v === "") return "empty";
  if (v.length > 30) return "long";
  return NOT_A_NAME.test(v) ? "chars" : null;
}

/**
 * Add a student, or change one (job CS). The record is the MINIMUM and the form has no other box: a first name or initials (no digits, no e-mail address), the class and section, the school's admission number and the day the student joined.
 * The adult we write to is the guardian (an existing contact); an adult student is that contact themself and has no label. The contact and the kind never change. The id is the page's, so a second press is a retry.
 */
export function StudentForm({ base, studentId, student, guardians, guardianFixed, programmes, words, actions, go }: {
  base: string; studentId: string; student: StudentOut | null; guardians: readonly GuardianChoice[]; guardianFixed: GuardianChoice | null; programmes: readonly ProgrammeOut[]; words: TodayWords; actions: StudentFormActions; go?: (href: string) => void;
}) {
  const router = useRouter();
  const nav = go ?? ((href: string) => router.push(href));
  const [contactId, setContactId] = React.useState(student?.contact_id ?? guardianFixed?.id ?? "");
  const [find, setFind] = React.useState("");
  const [adult, setAdult] = React.useState(student?.is_adult ?? false);
  const [name, setName] = React.useState(student?.display_name ?? "");
  const [programmeId, setProgrammeId] = React.useState(student?.programme_id ?? programmes.find((p) => p.active)?.id ?? "");
  const [groupId, setGroupId] = React.useState(student?.group_id ?? "");
  const [admissionNo, setAdmissionNo] = React.useState(student?.admission_no ?? "");
  const [joined, setJoined] = React.useState(student?.joined_on ?? "");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const programme = programmes.find((p) => p.id === programmeId) ?? null;
  const groups = (programme?.groups ?? []).filter((g) => g.active || g.id === student?.group_id);
  const shown = guardians.filter((g) => find.trim() === "" || g.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 50);
  const existing = student !== null;

  async function save() {
    if (busy) return;
    setProblem(null);
    if (contactId === "") return setProblem({ text: say(words, "edu.err.guardian") });
    if (!adult) {
      const p = labelProblem(name);
      if (p) return setProblem({ text: say(words, `edu.err.label.${p}`) });
    }
    if (programmeId === "") return setProblem({ text: say(words, "edu.err.programme") });
    if (programme && programme.group_kind !== "none" && groups.length > 0 && groupId === "") return setProblem({ text: say(words, "edu.err.group", { kind: say(words, `edu.divided.${programme.group_kind}`) }) });
    setBusy(true);
    const out = await actions.save(studentId, { contactId, isAdult: adult, childLabel: adult ? "" : name.trim(), programmeId, groupId: programme?.group_kind === "none" ? "" : groupId, admissionNo: admissionNo.trim(), joinedOn: joined });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    nav(`${base}/students/${out.studentId}?saved=1`);
  }

  return (
    <form data-screen="student-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-2xl flex-col gap-5">
      {!existing && guardianFixed === null ? (
        <div>
          <label htmlFor="sf-find" className={label}>{say(words, "edu.sf.guardian")}</label>
          <input id="sf-find" value={find} disabled={busy} onChange={(e) => setFind(e.target.value)} aria-describedby="sf-find-h" placeholder={say(words, "edu.sf.find")} className={field} />
          <label htmlFor="sf-guardian" className="sr-only">{say(words, "edu.sf.guardian.pick")}</label>
          <select id="sf-guardian" value={contactId} disabled={busy} onChange={(e) => setContactId(e.target.value)} className={`${field} mt-2`}>
            <option value="">{say(words, "edu.sf.choose")}</option>
            {shown.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </select>
          <p id="sf-find-h" className={help}>{say(words, "edu.sf.guardian.help")}</p>
        </div>
      ) : (
        <div>
          <p className={label}>{say(words, "edu.sf.guardian")}</p>
          <p className="text-base font-semibold" data-part="guardian">{(guardianFixed ?? guardians.find((g) => g.id === contactId))?.name ?? student?.contact_name ?? ""}</p>
        </div>
      )}
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={adult} disabled={busy || existing} onChange={(e) => setAdult(e.target.checked)} />
        {say(words, "edu.sf.adult")}
      </label>
      {!adult ? (
        <div>
          <label htmlFor="sf-label" className={label}>{say(words, "edu.sf.label")}</label>
          <input id="sf-label" value={name} maxLength={30} disabled={busy} autoComplete="off" onChange={(e) => setName(e.target.value)} aria-describedby="sf-label-h" className={field} />
          <p id="sf-label-h" className={help}>{say(words, "edu.sf.label.help")}</p>
        </div>
      ) : (
        <p role="note" className={help}>{say(words, "edu.sf.adult.help")}</p>
      )}
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="sf-prog" className={label}>{say(words, "edu.sf.programme")}</label>
          <select id="sf-prog" value={programmeId} disabled={busy} onChange={(e) => { setProgrammeId(e.target.value); setGroupId(""); }} className={field}>
            {programmes.filter((p) => p.active || p.id === student?.programme_id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        {programme && programme.group_kind !== "none" ? (
          <div>
            <label htmlFor="sf-group" className={label}>{say(words, `edu.divided.${programme.group_kind}`)}</label>
            <select id="sf-group" value={groupId} disabled={busy} onChange={(e) => setGroupId(e.target.value)} className={field}>
              <option value="">{say(words, "edu.sf.choose")}</option>
              {groups.map((g) => (<option key={g.id} value={g.id}>{g.label}{g.timing ? ` · ${g.timing}` : ""}</option>))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor="sf-adm" className={label}>{say(words, "edu.sf.admno")}</label>
          <input id="sf-adm" value={admissionNo} maxLength={30} disabled={busy} onChange={(e) => setAdmissionNo(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="sf-joined" className={label}>{say(words, "edu.sf.joined")}</label>
          <input id="sf-joined" type="date" value={joined} disabled={busy} onChange={(e) => setJoined(e.target.value)} className={field} />
        </div>
      </div>
      <p role="note" className={help}>{say(words, "edu.sf.minimum")}</p>
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primary} disabled={busy}>{busy ? say(words, "today.act.working") : say(words, existing ? "edu.sf.save.edit" : "edu.sf.save.new")}</button>
        <Link href={existing ? `${base}/students/${studentId}` : `${base}/students`} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
