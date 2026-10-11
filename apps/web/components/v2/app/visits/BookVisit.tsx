"use client";

import * as React from "react";

import type { Slots } from "@/lib/api/visits";

import { say, type TodayWords } from "../today/today-words";
import type { CustomerHit, StepResult, VisitsActions } from "./actions-types";
import { SlotPicker, type SlotChoice } from "./SlotPicker";
import { card, errorLine, field, help, label, okLine, primary, secondary } from "./styles";

type Lead = { leadId: string; label: string };

/**
 * "Book a visit" (job AV): find the customer (a name search, or the lead the person came from), pick a day and a free time, say how many are coming and what for, and book. Booking sends nothing to the
 * customer; the visit starts as "waiting for the customer" and a person confirms it. An advance is optional and OFF: it never stops a booking. The page gives the form one id per attempt, so pressing
 * twice books once. The API's refusals (the time was just taken, the shop is closed that day...) come back as our sentences and keep what was typed.
 */
export function BookVisit({ words, lang, actions, today, start, lead: given, slots: initialSlots }: { words: TodayWords; lang: string; actions: Pick_Actions; today: string; start: SlotChoice; lead: Lead | null; slots: Slots | null }) {
  const [lead, setLead] = React.useState<Lead | null>(given);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<CustomerHit[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [pick, setPick] = React.useState<SlotChoice>(start);
  const [party, setParty] = React.useState("1");
  const [purpose, setPurpose] = React.useState("");
  const [note, setNote] = React.useState("");
  const [advanceOn, setAdvanceOn] = React.useState(false);
  const [advance, setAdvance] = React.useState("");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<Extract<StepResult, { ok: false }> | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchError(null);
    let result;
    try {
      result = await actions.customers(q);
    } catch {
      result = { ok: false as const, error: say(words, "today.err.generic") };
    }
    setSearching(false);
    if (result.ok) setHits(result.items);
    else {
      setHits(null);
      setSearchError(result.error || say(words, "today.err.generic"));
    }
  }

  const partyNumber = Number(party);
  const advanceNumber = Number(advance);
  const partyOk = Number.isInteger(partyNumber) && partyNumber >= 1 && partyNumber <= 50;
  const advanceOk = !advanceOn || (Number.isFinite(advanceNumber) && advanceNumber >= 1 && advanceNumber <= 1_000_000);
  const ready = lead !== null && pick.slot !== null && partyOk && advanceOk && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || lead === null || pick.slot === null) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    let result: StepResult;
    try {
      result = await actions.book({ visitId: id, leadId: lead.leadId, date: pick.date, slot: pick.slot, partySize: partyNumber, purpose: purpose.trim(), note: note.trim(), advanceRupees: advanceOn ? advanceNumber : null });
    } catch {
      result = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setDone(result.message);
    setId(crypto.randomUUID());
    setPick({ date: pick.date, slot: null });
    setParty("1");
    setPurpose("");
    setNote("");
    setAdvanceOn(false);
    setAdvance("");
    if (given === null) {
      setLead(null);
      setHits(null);
      setQuery("");
    }
  }

  return (
    <section aria-labelledby="book-heading" id="book" className={`${card} scroll-mt-24`}>
      <h2 id="book-heading" className="font-display text-xl font-semibold">
        {say(words, "visits.book.title")}
      </h2>
      <p className="text-sm text-muted">{say(words, "visits.book.note")}</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <p className={label}>{say(words, "visits.book.customer")}</p>
          {lead ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{lead.label}</span>
              <button type="button" onClick={() => setLead(null)} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-text hover:underline">
                {say(words, "visits.book.change")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  aria-label={say(words, "visits.book.customer")}
                  value={query}
                  maxLength={100}
                  placeholder={say(words, "visits.book.search.placeholder")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void search(e);
                  }}
                  className={field}
                />
                <button type="button" disabled={searching || query.trim().length < 2} onClick={(e) => void search(e)} className={secondary}>
                  {searching ? say(words, "today.act.working") : say(words, "visits.book.search")}
                </button>
              </div>
              {searchError ? <p role="alert" className={errorLine}>{searchError}</p> : null}
              {hits !== null && hits.length === 0 ? (
                <p role="status" className="text-sm text-muted">
                  {say(words, "visits.book.none")}
                </p>
              ) : null}
              {hits !== null && hits.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {hits.map((h) => (
                    <li key={h.leadId}>
                      <button
                        type="button"
                        onClick={() => setLead({ leadId: h.leadId, label: h.city ? `${h.label}, ${h.city}` : h.label })}
                        className="flex min-h-12 w-full items-center rounded-lg border border-edge bg-surface px-3 text-left text-base font-semibold hover:bg-surface-2 [overflow-wrap:anywhere]"
                      >
                        {h.label}
                        {h.city ? <span className="ml-2 font-normal text-muted">{h.city}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={help}>{say(words, "visits.book.search.hint")}</p>
            </div>
          )}
        </div>

        <SlotPicker words={words} lang={lang} min={today} value={pick} onChange={setPick} load={actions.slots} initial={initialSlots} idPrefix="book" />

        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-[7.5rem_minmax(0,1fr)]">
          <div>
            <label htmlFor="book-party" className={label}>
              {say(words, "visits.book.party")}
            </label>
            <input id="book-party" type="number" inputMode="numeric" min={1} max={50} value={party} onChange={(e) => setParty(e.target.value)} className={field} aria-invalid={!partyOk} />
          </div>
          <div>
            <label htmlFor="book-purpose" className={label}>
              {say(words, "visits.book.purpose")}
            </label>
            <input id="book-purpose" value={purpose} maxLength={200} placeholder={say(words, "visits.book.purpose.placeholder")} onChange={(e) => setPurpose(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label htmlFor="book-note" className={label}>
            {say(words, "visits.book.note.label")}
          </label>
          <textarea id="book-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className={`${field} py-2`} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" checked={advanceOn} onChange={(e) => setAdvanceOn(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
            {say(words, "visits.book.advance")}
          </label>
          {advanceOn ? (
            <div>
              <label htmlFor="book-advance" className={label}>
                {say(words, "visits.book.advance.amount")}
              </label>
              <input id="book-advance" type="number" inputMode="decimal" min={1} max={1000000} value={advance} onChange={(e) => setAdvance(e.target.value)} className={field} aria-invalid={!advanceOk} />
              <p className={help}>{say(words, "visits.book.advance.hint")}</p>
            </div>
          ) : null}
        </div>

        {problem ? <p role="alert" className={errorLine}>{problem.error}</p> : null}
        {done ? <p role="status" className={okLine}>{done}</p> : null}
        <div>
          <button type="submit" disabled={!ready} className={primary}>
            {busy ? say(words, "today.act.working") : say(words, "visits.book.submit")}
          </button>
          {!ready && !busy && (lead === null || pick.slot === null) ? <p className={help}>{say(words, lead === null ? "visits.book.need.customer" : "visits.book.need.time")}</p> : null}
        </div>
      </form>
    </section>
  );
}

type Pick_Actions = Pick<VisitsActions, "book" | "slots" | "customers">;
