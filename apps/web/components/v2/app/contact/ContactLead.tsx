"use client";

import Link from "next/link";
import * as React from "react";

import { OUTBOX_CATEGORIES, OUTBOX_LANGUAGES } from "@/lib/api/outbox";

import { say, type TodayWords } from "../today/today-words";
import { card, errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";
import type { ContactActions, ContactResult } from "./contact-types";
import { useKeepRecord } from "./use-keep-record";

type Mode = "none" | "whatsapp" | "call";
const KINDS = OUTBOX_CATEGORIES;

/**
 * "Contact this lead" on the lead page (job AV): two ways to reach the lead, both through the shop's own rules, plus a button to book a visit to the shop.
 *
 * - "Contact on WhatsApp": the person writes the words; they go to the OUTBOX, where the send policy decides whether they go now, wait for 9:00 or wait for the owner. Nothing opens WhatsApp and the page never shows or
 *   holds a number.
 * - "Request a call": a reason and what to say; the request goes to the owner for approval (it appears on Today). Nothing is dialled from here.
 * - "Keep a record of this" (ticked unless unticked on this device) is the ONLY thing that decides whether the contact is also written to the lead's history. A record is only made once a WhatsApp message has really
 *   gone out; every other rule (consent, stop lists, limits, the owner's approval) applies whether it is ticked or not. The result says exactly what was and was not recorded.
 * One id per attempt, so pressing twice is a retry, and a fresh id after a request went through.
 */
export function ContactLead({ words, actions, bookHref, todayHref, addCustomerHref, noContact }: { words: TodayWords; actions: ContactActions; bookHref: string; todayHref: string; addCustomerHref: string; noContact: boolean }) {
  const [mode, setMode] = React.useState<Mode>("none");
  const [keep, setKeep] = useKeepRecord();
  const [ids, setIds] = React.useState(() => ({ message: crypto.randomUUID(), touch: crypto.randomUUID(), call: crypto.randomUUID() }));
  const [text, setText] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [kind, setKind] = React.useState<string>("info");
  const [reason, setReason] = React.useState("");
  const [script, setScript] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ContactResult | null>(null);

  const open = (m: Mode) => {
    setMode((cur) => (cur === m ? "none" : m));
    setResult(null);
  };

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    let out: ContactResult;
    try {
      out = mode === "whatsapp" ? await actions.whatsapp({ messageId: ids.message, touchId: ids.touch, text, language, category: kind, keepRecord: keep }) : await actions.call({ requestId: ids.call, reason, script, language });
    } catch {
      out = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    setResult(out);
    if (out.ok) {
      setIds({ message: crypto.randomUUID(), touch: crypto.randomUUID(), call: crypto.randomUUID() });
      setText("");
      setReason("");
      setScript("");
      setMode("none");
    }
  }

  const ready = mode === "whatsapp" ? text.trim().length >= 2 : reason.trim().length >= 2 && script.trim().length >= 2;
  return (
    <section aria-labelledby="contact-heading" data-part="contact" className={`${card} mt-4`}>
      <h2 id="contact-heading" className="font-display text-2xl font-bold leading-tight">
        {say(words, "contact.title")}
      </h2>
      <p className="text-sm text-muted">{say(words, "contact.intro")}</p>
      {noContact ? (
        <p role="note" className="text-base">
          {say(words, "contact.nocontact")}{" "}
          <Link href={addCustomerHref} className="font-semibold text-brand-text underline">
            {say(words, "contact.addcustomer")}
          </Link>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-expanded={mode === "whatsapp"} onClick={() => open("whatsapp")} className={mode === "whatsapp" ? primary : secondary}>
              {say(words, "contact.wa")}
            </button>
            <button type="button" aria-expanded={mode === "call"} onClick={() => open("call")} className={mode === "call" ? primary : secondary}>
              {say(words, "contact.call")}
            </button>
          </div>
          <div className="flex items-start gap-3 text-base">
            <input id="contact-keep" type="checkbox" checked={keep} aria-describedby="contact-keep-help" onChange={(e) => setKeep(e.target.checked)} className="mt-2.5 size-6 shrink-0 accent-brand-text" />
            <div className="pt-2">
              <label htmlFor="contact-keep" className="font-semibold">
                {say(words, "contact.keep")}
              </label>
              <p id="contact-keep-help" className="mt-0.5 text-sm font-normal text-muted">
                {say(words, "contact.keep.help")}
              </p>
            </div>
          </div>
        </>
      )}
      <div>
        <Link href={bookHref} className={secondary}>
          {say(words, "contact.visit")}
        </Link>
      </div>

      {mode !== "none" ? (
        <form onSubmit={send} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3.5" noValidate>
          {mode === "whatsapp" ? (
            <>
              <div>
                <label htmlFor="contact-text" className={label}>
                  {say(words, "contact.wa.text")}
                </label>
                <textarea id="contact-text" value={text} maxLength={3000} rows={5} onChange={(e) => setText(e.target.value)} className={`${field} py-2`} />
                <p className={help}>{say(words, "contact.wa.help")}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <div>
                  <label htmlFor="contact-lang" className={label}>
                    {say(words, "contact.language")}
                  </label>
                  <select id="contact-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                    {OUTBOX_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {say(words, `today.lang.${l}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="contact-kind" className={label}>
                    {say(words, "contact.kind")}
                  </label>
                  <select id="contact-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {say(words, `contact.kind.${k}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="contact-reason" className={label}>
                  {say(words, "contact.call.reason")}
                </label>
                <input id="contact-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="contact-script" className={label}>
                  {say(words, "contact.call.script")}
                </label>
                <textarea id="contact-script" value={script} maxLength={4000} rows={4} onChange={(e) => setScript(e.target.value)} className={`${field} py-2`} />
              </div>
              <div>
                <label htmlFor="contact-lang" className={label}>
                  {say(words, "contact.call.language")}
                </label>
                <select id="contact-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                  {OUTBOX_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {say(words, `today.lang.${l}`)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !ready} className={primary}>
              {busy ? say(words, "today.act.working") : say(words, mode === "whatsapp" ? "contact.wa.send" : "contact.call.send")}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("none")} className={quiet}>
              {say(words, "today.act.cancel")}
            </button>
          </div>
          <p className="text-sm text-muted">{say(words, mode === "whatsapp" ? "contact.wa.note" : "contact.call.note")}</p>
        </form>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className={errorLine}>
          {result.error}
        </p>
      ) : null}
      {result && result.ok ? (
        <div role="status" className={`${okLine} flex flex-col gap-1`} data-state={result.state}>
          <p>{result.text}</p>
          <p className="font-normal">{result.recordText}</p>
          {result.state === "needs_approval" || result.channel === "call" ? (
            <p className="font-normal">
              <Link href={todayHref} className="font-semibold underline">
                {say(words, "contact.today")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
