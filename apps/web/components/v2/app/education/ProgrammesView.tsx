"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { GroupOut, ProfileOut, ProgrammeOut } from "@contracts/education";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";

type Refused = { ok: false; error: string; mfa?: boolean };
export type ProfileInput = { institutionType: string; yearStartMonth: number; terms: { label: string; start_month: number; end_month: number }[]; parentLanguages: string[]; retentionMonths: number | null };
export type ProgrammeInput = { name: string; kind: "class" | "course"; groupKind: "section" | "year" | "semester" | "batch" | "none"; active: boolean };
export type GroupInput = { label: string; timing: string | null; active: boolean };
export type ProgrammesActions = {
  saveProfile: (input: ProfileInput) => Promise<{ ok: true } | Refused>;
  saveProgramme: (id: string, input: ProgrammeInput) => Promise<{ ok: true } | Refused>;
  saveGroup: (programmeId: string, id: string, input: GroupInput) => Promise<{ ok: true } | Refused>;
};

// eslint-disable-next-line no-restricted-syntax -- "coaching" here is a kind of institution (a coaching centre), not a business type of packages/packs
const TYPES = ["school", "junior_college", "degree_college", "university", "coaching", "training"] as const;
const LANGS = ["en", "te", "hi", "kn", "ta"] as const;
const GROUP_KINDS = ["section", "year", "semester", "batch", "none"] as const;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const MAX_TERMS = 6;

/**
 * The institution and its programmes (job CS; module `programmes`). The profile says what kind of place this is, when the academic year starts, its terms and which languages parents use; the Owner alone may set how long after
 * leaving a student's record is erased (with the authenticator code). A programme is a set of classes or a course, divided into sections, years, semesters or batches or nothing; it is never deleted, only made inactive. Owner and Admin write;
 * Sales read. The record of a student is the minimum, and nothing on this page names one.
 */
export function ProgrammesView({ profile, programmes, role, words, actions, base }: { profile: ProfileOut; programmes: readonly ProgrammeOut[]; role: Role; words: TodayWords; actions: ProgrammesActions; base: string }) {
  const router = useRouter();
  const writer = role === "owner" || role === "admin";
  const [type, setType] = React.useState<string>(profile.institution_type ?? "school");
  const [start, setStart] = React.useState<number>(profile.year_start_month ?? 6);
  const [terms, setTerms] = React.useState<{ label: string; start_month: number; end_month: number }[]>((profile.terms ?? []).map((t) => ({ ...t })));
  const [langs, setLangs] = React.useState<string[]>(profile.parent_languages && profile.parent_languages.length > 0 ? [...profile.parent_languages] : ["en"]);
  const [retention, setRetention] = React.useState(profile.student_retention_months ? String(profile.student_retention_months) : "");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [prog, setProg] = React.useState<null | { id: string; existing: ProgrammeOut | null }>(null);
  const [grp, setGrp] = React.useState<null | { programme: ProgrammeOut; id: string; existing: GroupOut | null }>(null);
  const [pf, setPf] = React.useState<ProgrammeInput>({ name: "", kind: "class", groupKind: "section", active: true });
  const [gf, setGf] = React.useState<GroupInput>({ label: "", timing: null, active: true });
  const [sheetProblem, setSheetProblem] = React.useState<string | null>(null);

  const toggleLang = (l: string) => setLangs((c) => (c.includes(l) ? c.filter((x) => x !== l) : [...c, l]));
  const setTerm = (i: number, patch: Partial<(typeof terms)[number]>) => setTerms((c) => c.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function saveProfile() {
    if (busy) return;
    setProblem(null);
    setSaved(false);
    if (langs.length === 0) return setProblem({ text: say(words, "edu.err.langs") });
    if (terms.some((t) => t.label.trim() === "")) return setProblem({ text: say(words, "edu.err.termname") });
    const months = retention.trim() === "" ? null : Number(retention);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 240)) return setProblem({ text: say(words, "edu.err.retention") });
    setBusy(true);
    const out = await actions.saveProfile({ institutionType: type, yearStartMonth: start, terms: terms.map((t) => ({ ...t, label: t.label.trim() })), parentLanguages: langs, retentionMonths: months });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setSaved(true);
    router.refresh();
  }

  function openProgramme(existing: ProgrammeOut | null) {
    setSheetProblem(null);
    setPf(existing ? { name: existing.name, kind: existing.kind, groupKind: existing.group_kind, active: existing.active } : { name: "", kind: "class", groupKind: "section", active: true });
    setProg({ id: existing?.id ?? crypto.randomUUID(), existing });
  }
  async function saveProgramme() {
    if (!prog || busy) return;
    if (pf.name.trim() === "") return setSheetProblem(say(words, "edu.err.progname"));
    setBusy(true);
    setSheetProblem(null);
    const out = await actions.saveProgramme(prog.id, { ...pf, name: pf.name.trim() });
    setBusy(false);
    if (!out.ok) return setSheetProblem(out.error);
    setProg(null);
    router.refresh();
  }
  function openGroup(programme: ProgrammeOut, existing: GroupOut | null) {
    setSheetProblem(null);
    setGf(existing ? { label: existing.label, timing: existing.timing, active: existing.active } : { label: "", timing: null, active: true });
    setGrp({ programme, id: existing?.id ?? crypto.randomUUID(), existing });
  }
  async function saveGroup() {
    if (!grp || busy) return;
    if (gf.label.trim() === "") return setSheetProblem(say(words, "edu.err.grouplabel"));
    setBusy(true);
    setSheetProblem(null);
    const out = await actions.saveGroup(grp.programme.id, grp.id, { label: gf.label.trim(), timing: gf.timing && gf.timing.trim() !== "" ? gf.timing.trim() : null, active: gf.active });
    setBusy(false);
    if (!out.ok) return setSheetProblem(out.error);
    setGrp(null);
    router.refresh();
  }

  return (
    <div data-screen="programmes" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.programmes")}</h1>
        <p className="text-base text-muted">{say(words, "edu.prog.sub")}</p>
      </header>

      <section className={card} aria-labelledby="pf-h" data-part="profile">
        <h2 id="pf-h" className="font-display text-xl font-bold">{say(words, "edu.profile.title")}</h2>
        {!profile.configured ? <p role="note" className={help}>{say(words, "edu.profile.new")}</p> : null}
        <form noValidate onSubmit={(e) => { e.preventDefault(); void saveProfile(); }} className="flex max-w-2xl flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor="pf-type" className={label}>{say(words, "edu.profile.type")}</label>
              <select id="pf-type" value={type} disabled={busy || !writer} onChange={(e) => setType(e.target.value)} className={field}>
                {TYPES.map((t) => (<option key={t} value={t}>{say(words, `edu.type.${t}`)}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="pf-start" className={label}>{say(words, "edu.profile.start")}</label>
              <select id="pf-start" value={start} disabled={busy || !writer} onChange={(e) => setStart(Number(e.target.value))} className={field}>
                {MONTHS.map((m) => (<option key={m} value={m}>{say(words, `edu.month.${m}`)}</option>))}
              </select>
            </div>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line p-3" disabled={busy || !writer}>
            <legend className="px-1 text-sm font-semibold">{say(words, "edu.profile.terms")}</legend>
            {terms.length === 0 ? <p className={help}>{say(words, "edu.profile.terms.none")}</p> : null}
            {terms.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2" data-term={i + 1}>
                <div className="col-span-4 min-[560px]:col-span-1">
                  <label htmlFor={`pf-t${i}`} className={label}>{say(words, "edu.profile.term", { n: i + 1 })}</label>
                  <input id={`pf-t${i}`} value={t.label} maxLength={40} onChange={(e) => setTerm(i, { label: e.target.value })} className={field} />
                </div>
                <div className="col-span-2 min-[560px]:col-span-1">
                  <label htmlFor={`pf-ts${i}`} className={label}>{say(words, "edu.profile.from")}</label>
                  <select id={`pf-ts${i}`} value={t.start_month} onChange={(e) => setTerm(i, { start_month: Number(e.target.value) })} className={field}>
                    {MONTHS.map((m) => (<option key={m} value={m}>{say(words, `edu.month.${m}`)}</option>))}
                  </select>
                </div>
                <div className="col-span-2 min-[560px]:col-span-1">
                  <label htmlFor={`pf-te${i}`} className={label}>{say(words, "edu.profile.to")}</label>
                  <select id={`pf-te${i}`} value={t.end_month} onChange={(e) => setTerm(i, { end_month: Number(e.target.value) })} className={field}>
                    {MONTHS.map((m) => (<option key={m} value={m}>{say(words, `edu.month.${m}`)}</option>))}
                  </select>
                </div>
                <button type="button" className={quiet} onClick={() => setTerms((c) => c.filter((_, j) => j !== i))} aria-label={say(words, "edu.profile.term.remove", { n: i + 1 })}>×</button>
              </div>
            ))}
            {terms.length < MAX_TERMS ? <div><button type="button" className={secondary} onClick={() => setTerms((c) => [...c, { label: "", start_month: start, end_month: start }])}>{say(words, "edu.profile.term.add")}</button></div> : null}
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line p-3" disabled={busy || !writer}>
            <legend className="px-1 text-sm font-semibold">{say(words, "edu.profile.langs")}</legend>
            <p className={help}>{say(words, "edu.profile.langs.help")}</p>
            <div className="flex flex-wrap gap-x-5">
              {LANGS.map((l) => (
                <label key={l} className="flex min-h-11 items-center gap-2 text-base">
                  <input type="checkbox" className="size-5 accent-brand-text" checked={langs.includes(l)} onChange={() => toggleLang(l)} />
                  {say(words, `today.lang.${l}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="pf-ret" className={label}>{say(words, "edu.profile.retention")}</label>
            <input id="pf-ret" inputMode="numeric" value={retention} disabled={busy || role !== "owner"} onChange={(e) => setRetention(e.target.value)} aria-describedby="pf-ret-h" className={`${field} max-w-40`} />
            <p id="pf-ret-h" className={help}>{say(words, role === "owner" ? "edu.profile.retention.help" : "edu.profile.retention.owner")}</p>
          </div>
          {saved ? <p role="status" className={okLine}>{say(words, "edu.profile.saved")}</p> : null}
          {problem ? (
            <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
              <p>{problem.text}</p>
              {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
            </div>
          ) : null}
          {writer ? <div><button type="submit" className={primary} disabled={busy}>{busy ? say(words, "today.act.working") : say(words, "edu.profile.save")}</button></div> : <p className={help}>{say(words, "edu.readonly")}</p>}
        </form>
      </section>

      <section aria-labelledby="pg-h" className="flex flex-col gap-3" data-part="programmes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pg-h" className="font-display text-xl font-bold">{say(words, "edu.prog.title")}</h2>
          {writer ? <button type="button" className={primary} onClick={() => openProgramme(null)}>{say(words, "edu.prog.add")}</button> : null}
        </div>
        {programmes.length === 0 ? (
          <p className="rounded-2xl border border-line p-4 text-base text-muted" data-part="empty">{say(words, "edu.prog.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {programmes.map((p) => (
              <li key={p.id} data-programme={p.id} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold [overflow-wrap:anywhere]">{p.name}</p>
                    <p className="text-sm text-muted">{say(words, `edu.kind.${p.kind}`)} · {say(words, "edu.prog.students", { n: p.students })}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!p.active ? <Pill tone="neutral">{say(words, "edu.inactive")}</Pill> : null}
                    <Link href={`${base}/students?programme=${p.id}`} className={secondary}>{say(words, "edu.prog.see")}</Link>
                    {writer ? <button type="button" className={secondary} onClick={() => openProgramme(p)}>{say(words, "edu.edit")}</button> : null}
                  </div>
                </div>
                {p.group_kind !== "none" ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold">{say(words, `edu.groups.${p.group_kind}`)}</p>
                    {p.groups.length === 0 ? <p className={help}>{say(words, "edu.groups.none")}</p> : (
                      <ul className="flex flex-wrap gap-2">
                        {p.groups.map((g) => (
                          <li key={g.id}>
                            {writer ? (
                              <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-4 text-base font-semibold hover:bg-surface-2" onClick={() => openGroup(p, g)} aria-label={say(words, "edu.groups.edit", { label: g.label })}>
                                {g.label}{g.timing ? ` · ${g.timing}` : ""} <span className="text-sm font-normal text-muted">{g.students}</span>{!g.active ? ` · ${say(words, "edu.inactive")}` : ""}
                              </button>
                            ) : (
                              <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-base">{g.label}{g.timing ? ` · ${g.timing}` : ""} <span className="text-sm text-muted">{g.students}</span></span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {writer ? <div><button type="button" className={secondary} onClick={() => openGroup(p, null)}>{say(words, `edu.groups.add.${p.group_kind}`)}</button></div> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={prog !== null} onClose={() => !busy && setProg(null)} busy={busy} id="programme" title={say(words, prog?.existing ? "edu.prog.edit" : "edu.prog.new")} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor="pg-name" className={label}>{say(words, "edu.prog.name")}</label>
          <input id="pg-name" data-autofocus value={pf.name} maxLength={80} disabled={busy} onChange={(e) => setPf({ ...pf, name: e.target.value })} className={field} />
        </div>
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="pg-kind" className={label}>{say(words, "edu.prog.kind")}</label>
            <select id="pg-kind" value={pf.kind} disabled={busy} onChange={(e) => setPf({ ...pf, kind: e.target.value as ProgrammeInput["kind"] })} className={field}>
              <option value="class">{say(words, "edu.kind.class")}</option>
              <option value="course">{say(words, "edu.kind.course")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="pg-gk" className={label}>{say(words, "edu.prog.divided")}</label>
            <select id="pg-gk" value={pf.groupKind} disabled={busy} onChange={(e) => setPf({ ...pf, groupKind: e.target.value as ProgrammeInput["groupKind"] })} className={field}>
              {GROUP_KINDS.map((k) => (<option key={k} value={k}>{say(words, `edu.divided.${k}`)}</option>))}
            </select>
          </div>
        </div>
        {prog?.existing ? (
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" className="size-5 accent-brand-text" checked={pf.active} disabled={busy} onChange={(e) => setPf({ ...pf, active: e.target.checked })} />
            {say(words, "edu.active")}
          </label>
        ) : null}
        <p className={help}>{say(words, "edu.prog.note")}</p>
        {sheetProblem ? <p role="alert" className={errorLine}>{sheetProblem}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void saveProgramme()}>{busy ? say(words, "today.act.working") : say(words, "edu.save")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setProg(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>

      <Sheet open={grp !== null} onClose={() => !busy && setGrp(null)} busy={busy} id="group" title={grp ? say(words, grp.existing ? "edu.group.edit" : "edu.group.new", { programme: grp.programme.name }) : ""} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor="gr-label" className={label}>{say(words, "edu.group.label")}</label>
          <input id="gr-label" data-autofocus value={gf.label} maxLength={80} disabled={busy} onChange={(e) => setGf({ ...gf, label: e.target.value })} className={field} />
        </div>
        {grp?.programme.group_kind === "batch" ? (
          <div>
            <label htmlFor="gr-timing" className={label}>{say(words, "edu.group.timing")}</label>
            <input id="gr-timing" value={gf.timing ?? ""} maxLength={80} disabled={busy} onChange={(e) => setGf({ ...gf, timing: e.target.value })} className={field} />
          </div>
        ) : null}
        {grp?.existing ? (
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" className="size-5 accent-brand-text" checked={gf.active} disabled={busy} onChange={(e) => setGf({ ...gf, active: e.target.checked })} />
            {say(words, "edu.active")}
          </label>
        ) : null}
        {sheetProblem ? <p role="alert" className={errorLine}>{sheetProblem}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void saveGroup()}>{busy ? say(words, "today.act.working") : say(words, "edu.save")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setGrp(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
