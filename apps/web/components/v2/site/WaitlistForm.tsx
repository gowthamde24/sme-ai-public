"use client";

import { CheckCircle2 } from "lucide-react";
import type * as React from "react";
import { useState, useTransition } from "react";

import { Turnstile } from "@/components/v2/controls/Turnstile";
import { btnPrimary } from "@/components/v2/site/ui";
import type { WaitlistLang, WaitlistResult } from "@/lib/waitlist/types";

export type WaitlistWords = {
  name: string; type: string; city: string; contact: string; language: string; marketing: string; notice: string; privacy: string; submit: string; thanksTitle: string; thanksBody: string;
  errName: string; errCity: string; errContact: string; errRate: string; errDown: string; errGeneric: string; errCheck: string;
};

const field = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";
const label = "mb-1.5 block text-sm font-semibold";

/**
 * "Book a demo / join the waitlist" (job DQ): a name, the kind of business, a city, a phone number or an e-mail, the language, and a SEPARATE box for news and offers that is never ticked for the visitor. The server checks it all and
 * posts it to the API; this file holds no dictionary and names no business type (the words, the business types and the languages come from the server as props). A hidden field that only a script fills is the trap for bots.
 * After a good answer the form is replaced by the thank-you.
 */
export function WaitlistForm({ lang, types, langs, words, action, privacyHref, idPrefix = "wl", turnstile = null, variant = "form" }: { /** The Turnstile site key when the check is on (the server decides): the form then needs its token. */ turnstile?: string | null; /** `bar`: the home page's finale (landing v2): one glass command bar with the name, the mobile, the business and the city; the page's language; no marketing box (the page promises no marketing messages). */ variant?: "form" | "bar"; lang: string; types: readonly { slug: string; name: string }[]; langs: readonly { code: WaitlistLang; name: string }[]; words: WaitlistWords; action: (input: unknown) => Promise<WaitlistResult>; privacyHref: string; idPrefix?: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState(types[0]?.slug ?? "other");
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [language, setLanguage] = useState<string>(langs.some((l) => l.code === lang) ? lang : "en");
  const [marketing, setMarketing] = useState(false);
  const [trap, setTrap] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const errors: Record<string, string> = { name: words.errName, city: words.errCity, contact: words.errContact, rate: words.errRate, down: words.errDown, invalid: words.errGeneric, check: words.errCheck };
  if (done && variant === "bar")
    return (
      <p role="status" className="h2-pop m-0 font-display text-2xl font-extrabold lg:text-[30px]" data-part="waitlist-thanks">
        {words.thanksTitle}
      </p>
    );
  if (done)
    return (
      <div role="status" className="flex max-w-xl items-start gap-3 rounded-xl border border-line bg-surface p-5" data-part="waitlist-thanks">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-green-text" aria-hidden="true" />
        <div>
          <p className="font-display text-xl font-semibold">{words.thanksTitle}</p>
          <p className="mt-1 text-base text-muted">{words.thanksBody}</p>
        </div>
      </div>
    );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    start(async () => {
      try {
        const out = await action({ name, businessType: type, city, contact, language, marketingOptIn: variant === "bar" ? false : marketing, website: trap, turnstileToken: token });
        if (out.ok) setDone(true);
        else {
          setProblem(errors[out.error] ?? words.errGeneric);
          setAgain((n) => n + 1); // a token is good for one try
        }
      } catch {
        setProblem(words.errGeneric);
        setAgain((n) => n + 1);
      }
    });
  };
  const trapField = (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </label>
    </div>
  );
  if (variant === "bar") {
    const cell = "flex flex-col px-[22px] py-1 text-left max-lg:border-b max-lg:border-line max-lg:py-2.5 lg:border-r lg:border-line";
    const small = "text-xs font-bold text-muted";
    const input = "min-h-8 w-full border-0 bg-transparent text-base font-semibold text-ink";
    return (
      <form className="relative flex w-full flex-col items-center gap-3" data-part="waitlist" data-variant="bar" onSubmit={submit}>
        <div className="h2-glass grid w-full items-center rounded-[26px] p-2 text-left lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:rounded-full">
          <label className={cell}>
            <span className={small}>{words.name}</span>
            <input id={`${idPrefix}-name`} autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className={cell}>
            <span className={small}>{words.contact}</span>
            <input id={`${idPrefix}-contact`} type="tel" autoComplete="tel" inputMode="tel" maxLength={200} placeholder="+91" value={contact} onChange={(e) => setContact(e.target.value)} className={input} />
          </label>
          <label className={cell}>
            <span className={small}>{words.type}</span>
            <select id={`${idPrefix}-type`} value={type} onChange={(e) => setType(e.target.value)} className={`${input} p-0`}>
              {types.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className={`${cell} lg:border-r-0`}>
            <span className={small}>{words.city}</span>
            <input id={`${idPrefix}-city`} autoComplete="address-level2" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} className={input} />
          </label>
          <button type="submit" disabled={pending || (turnstile !== null && token === null)} className="m-1 inline-flex min-h-[60px] items-center justify-center gap-2 rounded-full bg-[#ff773c] px-[30px] text-[17px] font-extrabold text-[#1e1e24] shadow-[0_10px_24px_-10px_rgba(255,119,60,.8)] disabled:opacity-60">
            {words.submit}
          </button>
        </div>
        {trapField}
        {problem ? <p role="alert" className="rounded-lg bg-red-bg px-3 py-2 text-sm font-medium text-red-text">{problem}</p> : null}
        {turnstile ? <Turnstile siteKey={turnstile} lang={lang} onToken={setToken} again={again} /> : null}
        <p className="m-0 text-[13px] text-muted">
          {words.notice}{" "}
          <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
        </p>
      </form>
    );
  }
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      data-part="waitlist"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          try {
            const out = await action({ name, businessType: type, city, contact, language, marketingOptIn: marketing, website: trap, turnstileToken: token });
            if (out.ok) setDone(true);
            else {
              setProblem(errors[out.error] ?? words.errGeneric);
              setAgain((n) => n + 1); // a token is good for one try
            }
          } catch {
            setProblem(words.errGeneric);
            setAgain((n) => n + 1);
          }
        });
      }}
    >
      <div>
        <label htmlFor={`${idPrefix}-name`} className={label}>{words.name}</label>
        <input id={`${idPrefix}-name`} autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-type`} className={label}>{words.type}</label>
        <select id={`${idPrefix}-type`} value={type} onChange={(e) => setType(e.target.value)} className={field}>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-city`} className={label}>{words.city}</label>
        <input id={`${idPrefix}-city`} autoComplete="address-level2" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-contact`} className={label}>{words.contact}</label>
        <input id={`${idPrefix}-contact`} autoComplete="email tel" inputMode="email" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-lang`} className={label}>{words.language}</label>
        <select id={`${idPrefix}-lang`} value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
          {langs.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-brand-text" data-part="marketing-optin" />
        <span>{words.marketing}</span>
      </label>
      <p className="text-sm text-muted">
        {words.notice}{" "}
        <a href={privacyHref} target="_blank" rel="noopener" className="font-semibold text-brand-text underline underline-offset-2">{words.privacy}</a>
      </p>
      {problem ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-text">{problem}</p> : null}
      {turnstile ? <Turnstile siteKey={turnstile} lang={lang} onToken={setToken} again={again} /> : null}
      <button type="submit" disabled={pending || (turnstile !== null && token === null)} className={`${btnPrimary} self-start disabled:opacity-60`}>
        {words.submit}
      </button>
    </form>
  );
}
