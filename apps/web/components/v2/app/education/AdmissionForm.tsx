"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { ProgrammeOut } from "@contracts/education";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet } from "../visits/styles";
import type { GuardianChoice } from "./StudentForm";

type Refused = { ok: false; error: string; mfa?: boolean };
export type AdmissionFormInput = { source: string; programmeId: string; contactId: string; guardianName: string; guardianPhone: string };
export type AdmissionFormActions = { save: (admissionId: string, input: AdmissionFormInput) => Promise<{ ok: true; admissionId: string } | Refused> };

const SOURCES = ["whatsapp", "walk_in", "website", "ad", "referral", "other"] as const;
const PHONE = /^[0-9+ ()-]{3,32}$/;

/**
 * A new admission enquiry (job CS): where it came from, the class asked about (optional) and the adult: a guardian already in the list, or a new one with a name and the number they use on WhatsApp. NO child is stored until the
 * enquiry is admitted. The id is the page's, so a second press is a retry.
 */
export function AdmissionForm({ base, admissionId, programmes, guardians, words, actions, go }: { base: string; admissionId: string; programmes: readonly ProgrammeOut[]; guardians: readonly GuardianChoice[]; words: TodayWords; actions: AdmissionFormActions; go?: (href: string) => void }) {
  const router = useRouter();
  const nav = go ?? ((href: string) => router.push(href));
  const [source, setSource] = React.useState<string>("walk_in");
  const [programmeId, setProgrammeId] = React.useState("");
  const [existing, setExisting] = React.useState(false);
  const [contactId, setContactId] = React.useState("");
  const [find, setFind] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const shown = guardians.filter((g) => find.trim() === "" || g.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 50);

  async function save() {
    if (busy) return;
    setProblem(null);
    if (existing ? contactId === "" : name.trim() === "") return setProblem({ text: say(words, existing ? "edu.err.guardian" : "edu.err.gname") });
    if (!existing && !PHONE.test(phone.trim())) return setProblem({ text: say(words, "edu.err.gphone") });
    setBusy(true);
    const out = await actions.save(admissionId, { source, programmeId, contactId: existing ? contactId : "", guardianName: existing ? "" : name.trim(), guardianPhone: existing ? "" : phone.trim() });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    nav(`${base}/admissions/${out.admissionId}?saved=1`);
  }

  return (
    <form data-screen="admission-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-xl flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="ad-src" className={label}>{say(words, "edu.adm.source")}</label>
          <select id="ad-src" value={source} disabled={busy} onChange={(e) => setSource(e.target.value)} className={field}>
            {SOURCES.map((s) => (<option key={s} value={s}>{say(words, `edu.source.${s}`)}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="ad-prog" className={label}>{say(words, "edu.adm.asked")}</label>
          <select id="ad-prog" value={programmeId} disabled={busy} onChange={(e) => setProgrammeId(e.target.value)} className={field}>
            <option value="">{say(words, "edu.adm.notsure")}</option>
            {programmes.filter((p) => p.active).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4" disabled={busy}>
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "edu.adm.guardian")}</legend>
        {guardians.length > 0 ? (
          <div role="radiogroup" aria-label={say(words, "edu.adm.guardian")} className="flex flex-col gap-1">
            <label className="flex min-h-11 items-center gap-3 text-base"><input type="radio" name="gmode" className="size-5 accent-brand-text" checked={!existing} onChange={() => setExisting(false)} />{say(words, "edu.adm.new")}</label>
            <label className="flex min-h-11 items-center gap-3 text-base"><input type="radio" name="gmode" className="size-5 accent-brand-text" checked={existing} onChange={() => setExisting(true)} />{say(words, "edu.adm.existing")}</label>
          </div>
        ) : null}
        {existing ? (
          <div>
            <label htmlFor="ad-find" className={label}>{say(words, "edu.sf.find")}</label>
            <input id="ad-find" value={find} onChange={(e) => setFind(e.target.value)} className={field} />
            <label htmlFor="ad-contact" className="sr-only">{say(words, "edu.sf.guardian.pick")}</label>
            <select id="ad-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={`${field} mt-2`}>
              <option value="">{say(words, "edu.sf.choose")}</option>
              {shown.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor="ad-name" className={label}>{say(words, "edu.adm.gname")}</label>
              <input id="ad-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="ad-phone" className={label}>{say(words, "edu.adm.gphone")}</label>
              <input id="ad-phone" inputMode="tel" autoComplete="off" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} aria-describedby="ad-phone-h" className={field} />
              <p id="ad-phone-h" className={help}>{say(words, "edu.adm.gphone.help")}</p>
            </div>
          </div>
        )}
      </fieldset>
      <p role="note" className={help}>{say(words, "edu.adm.nochild")}</p>
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primary} disabled={busy}>{busy ? say(words, "today.act.working") : say(words, "edu.adm.save")}</button>
        <Link href={`${base}/admissions`} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
