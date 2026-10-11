"use client";

import Link from "next/link";
import * as React from "react";

import { OUTBOX_LANGUAGES } from "@/lib/api/outbox";
import type { Photo as PhotoData } from "@/lib/api/catalogue";

import { useKeepRecord } from "../contact/use-keep-record";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";
import { Photo } from "./Photo";
import type { LeadChoice, SendActions, SendOutcome } from "./catalogue-types";

const MAX_SEND_PHOTOS = 4;
const MAX_CAPTION = 1000;
const MIN_QUERY = 2;

type Lead = { leadId: string; label: string };
const leadLabel = (h: LeadChoice) => [h.customer ?? h.contactName ?? "", h.customer && h.contactName ? h.contactName : ""].filter(Boolean).join(" · ");

/** The WhatsApp-like preview: the photos in a grid (one, two, or four), the caption under them, and a line saying nothing has been sent. */
function Preview({ photos, text, name, words }: { photos: readonly PhotoData[]; text: string; name: string; words: TodayWords }) {
  return (
    <div data-part="preview" className="flex max-w-sm flex-col gap-1">
      <div className="rounded-2xl rounded-tl-sm border border-green-text bg-green-bg p-2">
        {photos.length > 0 ? (
          <div className={`grid gap-1 overflow-hidden rounded-xl ${photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {photos.map((ph, i) => (
              <div key={ph.id} className={photos.length === 3 && i === 0 ? "col-span-2" : ""}>
                <Photo src={ph.thumb_url} width={ph.width} height={ph.height} alt={say(words, "catalogue.photo.alt", { name, n: i + 1 })} words={words} shape={photos.length === 1 ? "card" : "square"} />
              </div>
            ))}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap px-1 pb-0.5 pt-2 text-base text-ink [overflow-wrap:anywhere]">{text.trim() === "" ? <span className="text-muted">{say(words, "catalogue.send.preview.empty")}</span> : text}</p>
      </div>
      <p className="text-sm text-muted">{say(words, "catalogue.send.preview.note")}</p>
    </div>
  );
}

/**
 * "Send to a customer" on a saree's page (job BC): choose a customer (search by name or the end of a phone number; the number itself is never shown), choose up to four of the photos, write the caption, see
 * the message as it will look on WhatsApp, and send it to the OUTBOX. The shop's own rules then decide, and the answer says in plain words which it was: sent, held until the morning, waiting for the owner
 * (and why), or not sent (and why). Nothing is ever sent from here without those rules. A price or a promise in the caption makes it wait for the owner. The caption is never machine-translated: the person writes
 * it in the customer's language. One id per attempt, so pressing twice is a retry; after a send the form is replaced by its answer.
 */
export function SendToCustomer({ itemId, name, photos, words, actions, lead: preset, outboxHref, todayHref }: { itemId: string; name: string; photos: readonly PhotoData[]; words: TodayWords; actions: SendActions; lead: Lead | null; outboxHref: string; todayHref: string }) {
  const template = say(words, "catalogue.send.template", { name });
  const [lead, setLead] = React.useState<Lead | null>(preset);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<LeadChoice[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchProblem, setSearchProblem] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<string[]>(() => photos.slice(0, MAX_SEND_PHOTOS).map((p) => p.id));
  const [text, setText] = React.useState(template);
  const [language, setLanguage] = React.useState("en");
  const [keep, setKeep] = useKeepRecord();
  const [messageId, setMessageId] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SendOutcome | null>(null);
  const asked = React.useRef(0);

  async function find(q: string) {
    const term = q.trim();
    const ticket = ++asked.current;
    if (term.length < MIN_QUERY) {
      setHits(null);
      setSearching(false);
      setSearchProblem(term.length === 0 ? null : say(words, "catalogue.send.lead.short"));
      return;
    }
    setSearching(true);
    setSearchProblem(null);
    let out;
    try {
      out = await actions.search(term);
    } catch {
      out = { ok: false as const, error: say(words, "catalogue.send.lead.error") };
    }
    if (ticket !== asked.current) return; // a newer search was started: this answer is old
    setSearching(false);
    if (out.ok) setHits(out.items);
    else {
      setHits(null);
      setSearchProblem(out.error);
    }
  }

  // search as the person types, after a short pause
  React.useEffect(() => {
    if (lead) return;
    const t = setTimeout(() => void find(query), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `find` only reads `actions` and `words`
  }, [query, lead]);

  const picked = photos.filter((p) => chosen.includes(p.id));
  const ready = lead !== null && picked.length >= 1 && text.trim().length >= 2 && !busy;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !lead) return;
    setBusy(true);
    let out: SendOutcome;
    try {
      out = await actions.send({ messageId, itemId, leadId: lead.leadId, photoIds: picked.map((p) => p.id), text: text.trim(), language, keepRecord: keep });
    } catch {
      out = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    setResult(out);
    if (out.ok) setMessageId(crypto.randomUUID());
  }

  if (result && result.ok) {
    return (
      <section aria-labelledby="send-heading" data-part="send" className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 md:p-5">
        <h2 id="send-heading" className="font-display text-2xl font-bold leading-tight">
          {say(words, "catalogue.send.title")}
        </h2>
        <div role="status" data-state={result.state} className={`${okLine} flex flex-col gap-1`}>
          <p>{result.text}</p>
          {result.why ? <p className="font-normal">{result.why}</p> : null}
          <p className="font-normal">{result.recordText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={outboxHref} className={secondary}>
            {say(words, "catalogue.send.outbox")}
          </Link>
          {result.state === "needs_approval" ? (
            <Link href={todayHref} className={secondary}>
              {say(words, "catalogue.send.today")}
            </Link>
          ) : null}
          <button
            type="button"
            className={primary}
            onClick={() => {
              setResult(null);
              setLead(null);
              setQuery("");
              setHits(null);
              setText(template);
            }}
          >
            {say(words, "catalogue.send.another")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="send-heading" data-part="send" className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="send-heading" className="font-display text-2xl font-bold leading-tight">
          {say(words, "catalogue.send.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{say(words, "catalogue.send.intro")}</p>
      </div>

      <form onSubmit={send} noValidate className="flex flex-col gap-4">
        <div data-part="lead">
          <p className={label}>{say(words, "catalogue.send.lead")}</p>
          {lead ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
              <p className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">{say(words, "catalogue.send.lead.chosen", { who: lead.label })}</p>
              <button type="button" disabled={busy} onClick={() => setLead(null)} className={secondary}>
                {say(words, "catalogue.send.lead.change")}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label htmlFor="send-find" className="sr-only">
                    {say(words, "catalogue.send.lead.search")}
                  </label>
                  <input id="send-find" type="search" value={query} maxLength={60} autoComplete="off" placeholder={say(words, "catalogue.send.lead.placeholder")} onChange={(e) => setQuery(e.target.value)} className={field} />
                </div>
                <button type="button" onClick={() => void find(query)} className={secondary}>
                  {say(words, "catalogue.send.lead.go")}
                </button>
              </div>
              <div aria-live="polite" className="mt-2">
                {searching ? <p className="text-sm text-muted">{say(words, "today.act.working")}</p> : null}
                {searchProblem ? <p className="text-sm text-muted">{searchProblem}</p> : null}
                {hits && hits.length === 0 && !searching ? <p className="text-sm text-muted">{say(words, "catalogue.send.lead.none")}</p> : null}
              </div>
              {hits && hits.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1" data-part="hits">
                  {hits.map((h) => (
                    <li key={h.leadId}>
                      <button type="button" onClick={() => setLead({ leadId: h.leadId, label: leadLabel(h) || h.city || "—" })} className="flex min-h-11 w-full flex-col items-start rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2">
                        <span className="text-base font-semibold [overflow-wrap:anywhere]">{leadLabel(h) || "—"}</span>
                        <span className="text-sm text-muted">
                          {[h.city, h.phoneLast4 ? say(words, "catalogue.send.lead.ends", { digits: h.phoneLast4 }) : null].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0" data-part="photos">
          <legend className={label}>{say(words, "catalogue.send.photos")}</legend>
          <ul className="flex flex-wrap gap-2">
            {photos.map((ph, i) => {
              const on = chosen.includes(ph.id);
              const full = !on && chosen.length >= MAX_SEND_PHOTOS;
              return (
                <li key={ph.id}>
                  <label className={`relative block min-h-11 w-20 overflow-hidden rounded-xl border-2 ${on ? "border-brand-edge" : "border-line"} ${full ? "opacity-60" : ""}`}>
                    <Photo src={ph.thumb_url} width={ph.width} height={ph.height} alt="" words={words} />
                    <span className="absolute left-1 top-1 inline-flex size-6 items-center justify-center rounded bg-surface">
                      <input
                        type="checkbox"
                        className="size-5 accent-brand-text"
                        checked={on}
                        disabled={full || busy}
                        aria-label={say(words, "catalogue.photo.alt", { name, n: i + 1 })}
                        onChange={(e) => setChosen((cur) => (e.target.checked ? photos.filter((p) => p.id === ph.id || cur.includes(p.id)).map((p) => p.id) : cur.filter((x) => x !== ph.id)))}
                      />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className={help}>{chosen.length >= MAX_SEND_PHOTOS ? say(words, "catalogue.send.photos.full") : say(words, "catalogue.send.photos.help")}</p>
          {picked.length === 0 ? <p className="text-sm font-medium text-red-text">{say(words, "catalogue.send.photos.none")}</p> : null}
        </fieldset>

        <div>
          <label htmlFor="send-text" className={label}>
            {say(words, "catalogue.send.caption")}
          </label>
          <textarea id="send-text" value={text} rows={4} maxLength={MAX_CAPTION} disabled={busy} aria-describedby="send-text-help" onChange={(e) => setText(e.target.value)} className={`${field} py-2`} />
          <p id="send-text-help" className={help}>
            {say(words, "catalogue.send.caption.help")}
          </p>
        </div>

        <div className="max-w-xs">
          <label htmlFor="send-lang" className={label}>
            {say(words, "contact.language")}
          </label>
          <select
            id="send-lang"
            value={language}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              // the ready-made English caption only suits English: another language starts empty, so the person writes it in the customer's own words
              if (next !== "en" && text === template) setText("");
              if (next === "en" && text.trim() === "") setText(template);
              setLanguage(next);
            }}
            className={field}
          >
            {OUTBOX_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {say(words, `today.lang.${l}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className={label}>{say(words, "catalogue.send.preview")}</p>
          <Preview photos={picked} text={text} name={name} words={words} />
        </div>

        <div className="flex items-start gap-3 text-base">
          <input id="send-keep" type="checkbox" checked={keep} aria-describedby="send-keep-help" onChange={(e) => setKeep(e.target.checked)} className="mt-2.5 size-6 shrink-0 accent-brand-text" />
          <div className="pt-2">
            <label htmlFor="send-keep" className="font-semibold">
              {say(words, "contact.keep")}
            </label>
            <p id="send-keep-help" className="mt-0.5 text-sm font-normal text-muted">
              {say(words, "contact.keep.help")}
            </p>
          </div>
        </div>

        {result && !result.ok ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{result.error}</p>
            {result.mfa ? (
              <Link href="/app/security" className="font-semibold underline">
                {say(words, "today.err.mfa.link")}
              </Link>
            ) : null}
          </div>
        ) : null}

        <div>
          <button type="submit" disabled={!ready} className={primary}>
            {busy ? say(words, "today.act.working") : say(words, "catalogue.send.go")}
          </button>
        </div>
      </form>
    </section>
  );
}
