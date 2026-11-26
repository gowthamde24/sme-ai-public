"use client";

import { useId, useState } from "react";

import { CONTACT_DAYS_AGO, CONTACT_NOTE_MAX, type ContactDaysAgo, type Prospect } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import type { Failed, Reply } from "../cc/kit";
import { makeT, type Words } from "../words";

export type MarkContactedActions = { mark: (prospectId: string, input: { daysAgo: ContactDaysAgo; note: string }) => Promise<Reply<Prospect>> };
type Shown = Pick<Prospect, "id" | "status" | "lastContactedAt" | "contactedBy" | "contactNote">;

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border-2 border-edge bg-surface px-4 font-bold text-ink disabled:opacity-60";
const day = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/**
 * "Mark as contacted" (Lead Finder v1.0, owner 19 Nov 2026), the third thing a person can do with a business the Lead Finder found, beside "Call from your phone" and "Plan a visit": they say they spoke to it themselves. It asks when (today, yesterday,
 * 2 days ago, a week ago) and an optional note, records who marked it, and then shows a solid "Contacted · 19 Nov" chip with the name and the note. It never calls or messages anyone; marking again only updates the day and the note.
 */
export function useMarkContacted(prospect: Shown, actions: MarkContactedActions) {
  const [now, setNow] = useState<Shown>(prospect);
  const [open, setOpen] = useState(false);
  const [daysAgo, setDaysAgo] = useState<ContactDaysAgo>(0);
  const [note, setNote] = useState(prospect.contactNote ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const contacted = now.status === "contacted" && now.lastContactedAt !== null;

  async function save() {
    setBusy(true);
    setFailure(null);
    const r = await actions.mark(now.id, { daysAgo, note: note.trim() });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setNow(r.data);
    setNote(r.data.contactNote ?? "");
    setOpen(false);
  }
  return { now, open, setOpen, daysAgo, setDaysAgo, note, setNote, busy, failure, contacted, save };
}
export type MarkState = ReturnType<typeof useMarkContacted>;

/** The solid "Contacted · 19 Nov" chip with who marked it and the note (nothing when it was not marked). */
export function ContactedNote({ m, words }: { m: Pick<MarkState, "now" | "contacted">; words: Words }) {
  const t = makeT(words);
  if (!m.contacted) return null;
  return (
    <div className="flex flex-col gap-1" data-part="contacted">
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center whitespace-nowrap rounded-md bg-ink px-3 text-sm font-bold text-surface" data-chip="contacted">
          {t("lf.v6.mark.chip", { date: day(m.now.lastContactedAt as string) })}
        </span>
        {m.now.contactedBy ? <span className="text-sm text-muted">{t("lf.v6.mark.by", { name: m.now.contactedBy })}</span> : null}
      </span>
      {m.now.contactNote ? <p className="m-0 break-words text-sm text-ink" data-part="contact-note">{m.now.contactNote}</p> : null}
    </div>
  );
}

/** The small form that opens under the button: when (today, yesterday, 2 days ago, a week ago), an optional note, Save and Cancel. */
export function MarkForm({ m, words }: { m: MarkState; words: Words }) {
  const t = makeT(words);
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.save();
      }}
    >
      <label htmlFor={`${id}-when`} className="text-sm font-semibold">
        {t("lf.v6.mark.when")}
      </label>
      <select id={`${id}-when`} value={m.daysAgo} onChange={(e) => m.setDaysAgo(Number(e.target.value) as ContactDaysAgo)} className="min-h-11 rounded-xl border border-edge bg-surface px-3" data-part="mark-when">
        {CONTACT_DAYS_AGO.map((d) => (
          <option key={d} value={d}>
            {t(`lf.v6.mark.when.${d}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-note`} className="text-sm font-semibold">
        {t("lf.v6.mark.note")}
      </label>
      <textarea id={`${id}-note`} value={m.note} maxLength={CONTACT_NOTE_MAX} rows={3} onChange={(e) => m.setNote(e.target.value)} placeholder={t("lf.v6.mark.note.ph")} className="rounded-xl border border-edge bg-surface p-3" data-part="mark-note" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={m.busy} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-5 font-bold text-on-brand disabled:opacity-60" data-act="mark-save">
          {t("lf.v6.mark.save")}
        </button>
        <button type="button" disabled={m.busy} className={btn} onClick={() => m.setOpen(false)} data-act="mark-cancel">
          {t("lf.v6.mark.cancel")}
        </button>
      </div>
      {m.failure ? <FailureNote failure={m.failure} words={words} /> : null}
    </form>
  );
}

export function MarkContacted({ prospect, words, actions }: { prospect: Shown; words: Words; actions: MarkContactedActions }) {
  const t = makeT(words);
  const m = useMarkContacted(prospect, actions);
  return (
    <div className="flex flex-col gap-2" data-part="mark-contacted">
      <ContactedNote m={m} words={words} />
      {!m.open ? (
        <button type="button" className={`${btn} write-ctl w-fit`} onClick={() => m.setOpen(true)} data-act="mark-contacted">
          {m.contacted ? t("lf.v6.mark.edit") : t("lf.v6.mark.button")}
        </button>
      ) : (
        <MarkForm m={m} words={words} />
      )}
    </div>
  );
}

export default MarkContacted;
