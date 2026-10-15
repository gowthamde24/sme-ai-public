"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { RecipientOut } from "@contracts";
import type { ProgrammeOut } from "@contracts/education";

import { formatRupees, rupeesToPaise } from "@/lib/money";
import type { LedgerFilter, RecipientRow } from "@/lib/api/campaigns";

import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";
import { parseList, type ParsedList } from "./campaign-logic";

type Refused = { ok: false; error: string; mfa?: boolean };
type Added = { ok: true; added: number; skipped: { row: number; reason: string }[]; recipients: number } | Refused;
export type AudienceActions = {
  fromLedger: (f: LedgerFilter) => Promise<Added>;
  importList: (rows: RecipientRow[]) => Promise<Added>;
  clear: () => Promise<{ ok: true; removed: number } | Refused>;
  remove: (recipientId: string) => Promise<{ ok: true } | Refused>;
  /** A school's announcement: everyone, one programme or one section (one message per guardian however many children). */
  announce?: (a: AnnounceInput) => Promise<Added>;
};
export type AnnounceInput = { scope: "all" | "programme" | "group"; programmeId: string; groupId: string; date: string };

/**
 * Who a campaign is for (job CQ). People come from the ledger (everyone with money open on claims due in a range: the amount is the OPEN total and the date the earliest due date, checked again before each message) or from a
 * list pasted or uploaded (one person per line: phone number or contact id, date, amount in rupees for a money reminder, a reference if the text uses one). A phone number only FINDS an existing contact of the business; a
 * person with no recorded consent is stopped message by message, not here. Every line is checked before it is sent and a line that cannot be read is named, never guessed. Changing the list of an approved campaign sends it back to draft.
 */
export function AudiencePanel({ status, money, fromLedger, studentParty = false, programmes = [], recipients, total, words, actions, canEdit, moreHref }: { status: string; money: boolean; fromLedger: boolean; studentParty?: boolean; programmes?: readonly ProgrammeOut[]; recipients: readonly RecipientOut[]; total: number; words: TodayWords; actions: AudienceActions; canEdit: boolean; moreHref: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [done, setDone] = React.useState<{ added: number; skipped: { row: number; reason: string }[] } | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [party, setParty] = React.useState<"" | "company" | "contact" | "student">(studentParty ? "student" : "");
  const [scope, setScope] = React.useState<"all" | "programme" | "group">("all");
  const [progId, setProgId] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const [asOf, setAsOf] = React.useState("");
  const [min, setMin] = React.useState("");
  const [text, setText] = React.useState("");
  const [read, setRead] = React.useState<ParsedList | null>(null);
  const [confirm, setConfirm] = React.useState<null | "clear">(null);
  const fresh = status !== "draft";
  const fail = (out: Refused) => setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });

  async function ledger() {
    setProblem(null);
    setDone(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return setProblem({ text: say(words, "camp.aud.err.range") });
    const minPaise = min.trim() === "" ? undefined : rupeesToPaise(min);
    if (min.trim() !== "" && (minPaise === null || minPaise === undefined || minPaise < 1)) return setProblem({ text: say(words, "due.err.amount") });
    setBusy(true);
    const out = await actions.fromLedger({ due_from: from, due_to: to, ...(party ? { party } : {}), ...(minPaise ? { min_open_paise: minPaise } : {}) });
    setBusy(false);
    if (!out.ok) return fail(out);
    setDone({ added: out.added, skipped: out.skipped });
    router.refresh();
  }
  function check() {
    setProblem(null);
    setDone(null);
    setRead(parseList(text, money));
  }
  async function add() {
    if (!read || read.rows.length === 0) return;
    setProblem(null);
    setBusy(true);
    const out = await actions.importList(read.rows);
    setBusy(false);
    if (!out.ok) return fail(out);
    setDone({ added: out.added, skipped: out.skipped });
    setRead(null);
    setText("");
    router.refresh();
  }
  async function file(f: File | null) {
    if (!f) return;
    if (f.size > 2_000_000) return setProblem({ text: say(words, "camp.aud.err.big") });
    setText(await f.text());
    setRead(null);
  }
  async function remove(id: string) {
    setBusy(true);
    const out = await actions.remove(id);
    setBusy(false);
    if (!out.ok) return fail(out);
    router.refresh();
  }
  async function clearAll() {
    setBusy(true);
    const out = await actions.clear();
    setBusy(false);
    setConfirm(null);
    if (!out.ok) return fail(out);
    router.refresh();
  }

  async function announce() {
    setProblem(null);
    setDone(null);
    if (!actions.announce) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return setProblem({ text: say(words, "camp.aud.err.date") });
    if (scope === "programme" && progId === "") return setProblem({ text: say(words, "camp.aud.err.programme") });
    if (scope === "group" && groupId === "") return setProblem({ text: say(words, "camp.aud.err.group") });
    setBusy(true);
    const out = await actions.announce({ scope, programmeId: progId, groupId, date: asOf });
    setBusy(false);
    if (!out.ok) return fail(out);
    setDone({ added: out.added, skipped: out.skipped });
    router.refresh();
  }
  const programme = programmes.find((p) => p.id === progId) ?? null;

  return (
    <div data-part="audience" className="flex flex-col gap-5">
      {canEdit && fresh ? <p role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text">{say(words, "camp.aud.backtodraft")}</p> : null}
      {canEdit && fromLedger ? (
        <section aria-labelledby="aud-ledger" className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <h2 id="aud-ledger" className="font-display text-xl font-bold">{say(words, "camp.aud.ledger.title")}</h2>
          <p className={help}>{say(words, "camp.aud.ledger.help")}</p>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div><label htmlFor="al-from" className={label}>{say(words, "camp.aud.from")}</label><input id="al-from" type="date" value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} className={field} /></div>
            <div><label htmlFor="al-to" className={label}>{say(words, "camp.aud.to")}</label><input id="al-to" type="date" value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} className={field} /></div>
            <div>
              <label htmlFor="al-party" className={label}>{say(words, "camp.aud.party")}</label>
              <select id="al-party" value={party} disabled={busy || studentParty} onChange={(e) => setParty(e.target.value as typeof party)} className={field}>
                {studentParty ? (
                  <option value="student">{say(words, "camp.aud.party.student")}</option>
                ) : (
                  <>
                    <option value="">{say(words, "camp.aud.party.any")}</option>
                    <option value="company">{say(words, "camp.aud.party.company")}</option>
                    <option value="contact">{say(words, "camp.aud.party.contact")}</option>
                  </>
                )}
              </select>
            </div>
            <div><label htmlFor="al-min" className={label}>{say(words, "camp.aud.min")}</label><input id="al-min" inputMode="decimal" value={min} disabled={busy} onChange={(e) => setMin(e.target.value)} className={field} /></div>
          </div>
          <div><button type="button" className={primary} disabled={busy} onClick={() => void ledger()}>{busy ? say(words, "today.act.working") : say(words, "camp.aud.ledger.go")}</button></div>
        </section>
      ) : null}
      {canEdit && actions.announce ? (
        <section aria-labelledby="aud-students" className="flex flex-col gap-3 rounded-2xl border border-line p-4" data-part="students-audience">
          <h2 id="aud-students" className="font-display text-xl font-bold">{say(words, "camp.aud.students.title")}</h2>
          <p className={help}>{say(words, "camp.aud.students.help")}</p>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor="as-scope" className={label}>{say(words, "camp.aud.students.scope")}</label>
              <select id="as-scope" value={scope} disabled={busy} onChange={(e) => { setScope(e.target.value as typeof scope); setProgId(""); setGroupId(""); }} className={field}>
                <option value="all">{say(words, "camp.aud.students.all")}</option>
                <option value="programme">{say(words, "camp.aud.students.programme")}</option>
                <option value="group">{say(words, "camp.aud.students.group")}</option>
              </select>
            </div>
            {scope !== "all" ? (
              <div>
                <label htmlFor="as-prog" className={label}>{say(words, "edu.sf.programme")}</label>
                <select id="as-prog" value={progId} disabled={busy} onChange={(e) => { setProgId(e.target.value); setGroupId(""); }} className={field}>
                  <option value="">{say(words, "edu.sf.choose")}</option>
                  {programmes.filter((p) => p.active && (scope === "programme" || p.groups.length > 0)).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </div>
            ) : null}
            {scope === "group" && programme ? (
              <div>
                <label htmlFor="as-group" className={label}>{say(words, `edu.divided.${programme.group_kind === "none" ? "section" : programme.group_kind}`)}</label>
                <select id="as-group" value={groupId} disabled={busy} onChange={(e) => setGroupId(e.target.value)} className={field}>
                  <option value="">{say(words, "edu.sf.choose")}</option>
                  {programme.groups.filter((g) => g.active).map((g) => (<option key={g.id} value={g.id}>{g.label}</option>))}
                </select>
              </div>
            ) : null}
            <div>
              <label htmlFor="as-date" className={label}>{say(words, "camp.aud.students.date")}</label>
              <input id="as-date" type="date" value={asOf} disabled={busy} onChange={(e) => setAsOf(e.target.value)} className={field} />
            </div>
          </div>
          <div><button type="button" className={primary} disabled={busy} onClick={() => void announce()}>{busy ? say(words, "today.act.working") : say(words, "camp.aud.students.go")}</button></div>
        </section>
      ) : null}
      {canEdit && !actions.announce ? (
        <section aria-labelledby="aud-import" className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <h2 id="aud-import" className="font-display text-xl font-bold">{say(words, "camp.aud.import.title")}</h2>
          <p className={help}>{say(words, money ? "camp.aud.import.help.money" : "camp.aud.import.help")}</p>
          <label htmlFor="ai-file" className={label}>{say(words, "camp.aud.file")}</label>
          <input id="ai-file" type="file" accept=".csv,.txt,text/csv,text/plain" disabled={busy} onChange={(e) => void file(e.target.files?.[0] ?? null)} className="block min-h-12 w-full text-base" />
          <label htmlFor="ai-text" className={label}>{say(words, "camp.aud.paste")}</label>
          <textarea id="ai-text" rows={5} value={text} disabled={busy} onChange={(e) => { setText(e.target.value); setRead(null); }} className={`${field} py-2 font-mono text-sm`} placeholder={say(words, money ? "camp.aud.example.money" : "camp.aud.example")} />
          <div><button type="button" className={secondary} disabled={busy || text.trim() === ""} onClick={check}>{say(words, "camp.aud.check")}</button></div>
          {read ? (
            <div role="status" data-part="read" className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
              <p className="font-semibold">{say(words, "camp.aud.read", { ok: read.rows.length, bad: read.errors.length })}</p>
              {read.errors.length > 0 ? (
                <ul className="list-inside list-disc text-sm text-red-text">
                  {read.errors.slice(0, 10).map((e) => (<li key={e.line}>{say(words, "camp.aud.line", { n: e.line, why: say(words, `camp.aud.why.${e.reason}`) })}</li>))}
                  {read.errors.length > 10 ? <li>{say(words, "camp.aud.more", { n: read.errors.length - 10 })}</li> : null}
                </ul>
              ) : null}
              <div><button type="button" className={primary} disabled={busy || read.rows.length === 0} onClick={() => void add()}>{busy ? say(words, "today.act.working") : say(words, "camp.aud.add", { n: read.rows.length })}</button></div>
            </div>
          ) : null}
        </section>
      ) : null}
      {done ? (
        <div role="status" className={`${okLine} flex flex-col gap-1`} data-part="added">
          <p>{say(words, "camp.aud.added", { n: done.added })}</p>
          {done.skipped.length > 0 ? (
            <ul className="list-inside list-disc text-sm">
              {done.skipped.slice(0, 10).map((s) => (<li key={s.row}>{say(words, "camp.aud.line", { n: s.row, why: words[`camp.aud.skip.${s.reason}`] ?? say(words, "camp.aud.skip.other") })}</li>))}
              {done.skipped.length > 10 ? <li>{say(words, "camp.aud.more", { n: done.skipped.length - 10 })}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <section aria-labelledby="aud-list" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="aud-list" className="font-display text-xl font-bold">{say(words, "camp.aud.list", { n: total })}</h2>
          {canEdit && total > 0 ? <button type="button" className={secondary} disabled={busy} onClick={() => setConfirm("clear")}>{say(words, "camp.aud.clear")}</button> : null}
        </div>
        {recipients.length === 0 ? (
          <p className="text-base text-muted">{say(words, "camp.aud.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recipients.map((r) => (
              <li key={r.id} data-recipient={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2">
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{r.contact_name}<span className="block text-sm font-normal text-muted">{[r.due_date, r.reference].filter(Boolean).join(" · ")}</span></span>
                {r.amount_paise !== null ? <span className="font-semibold tabular-nums">{formatRupees(r.amount_paise)}</span> : null}
                {r.closed_reason ? <Pill tone={r.closed_reason === "paid" ? "green" : "neutral"}>{say(words, `camp.closed.${r.closed_reason}`)}</Pill> : null}
                {canEdit ? <button type="button" className={quiet} disabled={busy} aria-label={say(words, "camp.aud.remove", { name: r.contact_name })} onClick={() => void remove(r.id)}>×</button> : null}
              </li>
            ))}
          </ul>
        )}
        {moreHref ? <p><Link href={moreHref} className={secondary}>{say(words, "mat.products.more")}</Link></p> : null}
      </section>
      <Sheet open={confirm === "clear"} onClose={() => !busy && setConfirm(null)} busy={busy} id="clear-list" title={say(words, "camp.aud.clear.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "camp.aud.clear.body", { n: total })}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void clearAll()}>{busy ? say(words, "today.act.working") : say(words, "camp.aud.clear.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setConfirm(null)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </div>
  );
}
